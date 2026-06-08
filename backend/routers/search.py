import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, Response
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from database import get_db
from dependencies import get_optional_user
from models import SearchRequest, ParseRequest, ParsedQuery, ValidateKeyRequest
from models_db import User
from services.llm_service import classify_intent, parse_query, validate_papers
from services.search_service import search_all_sources, enhance_with_unpaywall, get_source_names
from services.download_service import fetch_pdf_with_fallback
from services.pdf_finder_service import find_pdfs_with_kimi, generate_fallback_links
from config import (
    CORE_API_KEY, NASA_ADS_API_KEY, SERPAPI_KEY, KIMI_API_KEY,
    DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_SYSTEM_KEY,
)

router = APIRouter()


async def _resolve_api_key(
    request_api_key: Optional[str],
    optional_user: Optional[User],
    db: AsyncSession,
) -> str:
    """
    解析最终使用的 API Key：
    - 有自己的 Key → 直接用
    - 无 Key + 已登录 + 有免费额度 → 原子扣减，使用系统 Key
    - 否则抛 HTTPException
    """
    if request_api_key:
        return request_api_key

    if not optional_user:
        raise HTTPException(status_code=401, detail="请提供 DeepSeek API Key 或登录账号")
    if optional_user.free_searches <= 0:
        raise HTTPException(
            status_code=403,
            detail="免费次数已用完，请配置自己的 DeepSeek API Key 继续使用",
        )
    if not DEEPSEEK_SYSTEM_KEY:
        raise HTTPException(status_code=503, detail="系统暂不支持免费试用，请使用自己的 Key")

    # 原子扣减（WHERE free_searches > 0 防并发超额）
    result = await db.execute(
        sa_update(User)
        .where(User.id == optional_user.id, User.free_searches > 0)
        .values(free_searches=User.free_searches - 1)
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=403, detail="免费次数已用完，请配置自己的 DeepSeek API Key")

    return DEEPSEEK_SYSTEM_KEY


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/parse")
async def parse(
    request: ParseRequest,
    optional_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Phase 1: 意图识别 + 关键词提取，返回普通 JSON 供前端展示确认。
    注意：parse 阶段不扣减免费额度，只在 search 阶段扣减一次。"""
    api_key = request.api_key
    if not api_key:
        # 试用模式：验证用户有额度，但 parse 不扣减（search 时扣）
        if not optional_user:
            raise HTTPException(status_code=401, detail="请提供 DeepSeek API Key 或登录账号")
        if optional_user.free_searches <= 0:
            raise HTTPException(status_code=403, detail="免费次数已用完，请配置自己的 DeepSeek API Key")
        if not DEEPSEEK_SYSTEM_KEY:
            raise HTTPException(status_code=503, detail="系统暂不支持免费试用，请使用自己的 Key")
        api_key = DEEPSEEK_SYSTEM_KEY

    history = [{"role": m.role, "content": m.content} for m in request.messages]
    intent = await classify_intent(request.query, api_key, history)
    if intent.get("intent") == "chat":
        return {"intent": "chat", "reply": intent.get("reply", "请问有什么可以帮您？")}
    parsed = await parse_query(request.query, api_key, history)
    return {
        "intent": "search",
        "keywords": parsed.keywords,
        "date_from": parsed.date_from,
        "date_to": parsed.date_to,
    }


@router.post("/search")
async def search(
    request: SearchRequest,
    optional_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Phase 2: 执行搜索 + 验证，SSE 流式推送进度和结果。
    若 request.keywords 已提供，跳过意图识别和关键词解析。
    无 api_key 时走试用模式（需登录 + 有免费额度），扣减后使用系统 Key。"""
    # 在流式响应开始前完成鉴权和扣减（避免 DB session 在 SSE 流中生命周期问题）
    api_key = await _resolve_api_key(request.api_key, optional_user, db)

    async def generate():
        try:
            history = [{"role": m.role, "content": m.content} for m in request.messages]

            if request.keywords:
                # 前端已确认关键词，直接构造 ParsedQuery
                parsed = ParsedQuery(
                    keywords=request.keywords,
                    date_from=request.date_from,
                    date_to=request.date_to,
                    max_results=request.limit_per_source,
                )
            else:
                # 旧路径：兼容不带关键词的调用
                intent = await classify_intent(request.query, api_key, history)
                if intent.get("intent") == "chat":
                    yield sse("chat", {"message": intent.get("reply", "请问有什么可以帮您？")})
                    return
                yield sse("progress", {"message": "正在理解您的需求..."})
                parsed = await parse_query(request.query, api_key, history)

            kw_str = "、".join(parsed.keywords)
            yield sse("progress", {"message": f"正在搜索关键词：{kw_str}..."})

            # Notify frontend which sources will be searched
            source_names = get_source_names(request.sources)
            yield sse("search_start", {"sources": source_names})

            # Collect per-source completion events via queue
            source_queue: asyncio.Queue = asyncio.Queue()

            async def on_source_done(name: str, count: int) -> None:
                await source_queue.put({"source": name, "count": count})

            search_task = asyncio.create_task(
                search_all_sources(parsed, limit_per_source=request.limit_per_source,
                                   sources=request.sources, on_source_done=on_source_done)
            )

            # Drain progress events while search runs
            while not search_task.done():
                try:
                    item = source_queue.get_nowait()
                    yield sse("source_done", item)
                except asyncio.QueueEmpty:
                    await asyncio.sleep(0.05)

            # Drain any remaining events
            while not source_queue.empty():
                yield sse("source_done", source_queue.get_nowait())

            papers = await search_task
            if not papers:
                yield sse("done", {"papers": [], "message": "未找到相关论文，请尝试换个描述方式。"})
                return

            yield sse("progress", {"message": f"找到 {len(papers)} 篇论文，正在补全 PDF 链接..."})
            papers = await enhance_with_unpaywall(papers)

            yield sse("progress", {"message": f"正在验证相关性..."})
            accepted, rejected = await validate_papers(papers, request.query, api_key)
            final = accepted[:request.validated_limit]

            papers_dict = [p.model_dump() for p in final]
            rejected_dict = [p.model_dump() for p in rejected]
            yield sse("done", {
                "papers": papers_dict,
                "rejected_papers": rejected_dict,
                "message": f"为您找到 {len(final)} 篇相关论文。"
            })

            # ── PDF 深度查找（异步补充，不阻塞结果展示）──────────────────
            no_pdf = [p for p in final if not p.pdf_url]
            if no_pdf:
                yield sse("pdf_finding", {
                    "message": f"正在为 {len(no_pdf)} 篇无 PDF 的论文深度查找..."
                })
                kimi_results: dict[str, str] = {}
                if KIMI_API_KEY:
                    kimi_results = await find_pdfs_with_kimi(no_pdf, KIMI_API_KEY)

                updates = []
                for paper in no_pdf:
                    pdf_url = kimi_results.get(paper.paper_id)
                    updates.append({
                        "paper_id": paper.paper_id,
                        "pdf_url": pdf_url,
                        "fallback_links": [] if pdf_url else generate_fallback_links(paper),
                    })

                found = sum(1 for u in updates if u["pdf_url"])
                yield sse("pdf_update", {
                    "updates": updates,
                    "message": (
                        f"深度查找完成：新增 {found} 篇 PDF，其余 {len(updates) - found} 篇提供备用查找入口。"
                        if found else
                        f"未找到新 PDF，已为 {len(updates)} 篇论文提供备用查找入口。"
                    ),
                })

        except Exception as e:
            logger.error("Search pipeline error: %s", e, exc_info=True)
            yield sse("error", {"message": "搜索出错，请稍后重试。"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/validate-key")
async def validate_key(request: ValidateKeyRequest):
    """验证 DeepSeek API Key：发一条极小的 chat 请求，只看 HTTP 状态码。"""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{DEEPSEEK_BASE_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {request.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": DEEPSEEK_MODEL,
                    "messages": [{"role": "user", "content": "hi"}],
                    "max_tokens": 1,
                },
            )
        if resp.status_code == 200:
            return {"valid": True}
        logger.warning("validate-key status %s: %s", resp.status_code, resp.text[:200])
    except Exception as e:
        logger.warning("validate-key error: %s", e)
    return {"valid": False, "reason": "Key 无效，请检查后重新输入"}


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "sources": {
            "arxiv": True,
            "semantic_scholar": True,
            "openalex": True,
            "pubmed": True,
            "europe_pmc": True,
            "inspire_hep": True,
            "crossref": True,
            "core": bool(CORE_API_KEY),
            "nasa_ads": bool(NASA_ADS_API_KEY),
            "google_scholar_serpapi": bool(SERPAPI_KEY),
        },
    }


@router.get("/download")
async def download(
    url: str,
    doi: str | None = None,
    paper_id: str | None = None,
):
    try:
        content = await fetch_pdf_with_fallback(url, doi=doi, paper_id=paper_id)
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=paper.pdf"},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Download error: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail="下载失败，请稍后重试。")
