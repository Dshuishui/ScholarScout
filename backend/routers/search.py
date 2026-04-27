import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, Response

logger = logging.getLogger(__name__)

from models import SearchRequest, ParseRequest, ParsedQuery
from services.llm_service import classify_intent, parse_query, validate_papers
from services.search_service import search_all_sources, enhance_with_unpaywall
from services.download_service import fetch_pdf_bytes
from services.pdf_finder_service import find_pdfs_with_kimi, generate_fallback_links
from config import CORE_API_KEY, NASA_ADS_API_KEY, SERPAPI_KEY, KIMI_API_KEY

router = APIRouter()


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/parse")
async def parse(request: ParseRequest):
    """Phase 1: 意图识别 + 关键词提取，返回普通 JSON 供前端展示确认。"""
    history = [{"role": m.role, "content": m.content} for m in request.messages]
    intent = await classify_intent(request.query, request.api_key, history)
    if intent.get("intent") == "chat":
        return {"intent": "chat", "reply": intent.get("reply", "请问有什么可以帮您？")}
    parsed = await parse_query(request.query, request.api_key, history)
    return {
        "intent": "search",
        "keywords": parsed.keywords,
        "date_from": parsed.date_from,
        "date_to": parsed.date_to,
    }


@router.post("/search")
async def search(request: SearchRequest):
    """Phase 2: 执行搜索 + 验证，SSE 流式推送进度和结果。
    若 request.keywords 已提供，跳过意图识别和关键词解析。"""
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
                intent = await classify_intent(request.query, request.api_key, history)
                if intent.get("intent") == "chat":
                    yield sse("chat", {"message": intent.get("reply", "请问有什么可以帮您？")})
                    return
                yield sse("progress", {"message": "正在理解您的需求..."})
                parsed = await parse_query(request.query, request.api_key, history)

            kw_str = "、".join(parsed.keywords)
            yield sse("progress", {"message": f"正在搜索关键词：{kw_str}..."})
            papers = await search_all_sources(parsed, limit_per_source=request.limit_per_source, sources=request.sources)
            if not papers:
                yield sse("done", {"papers": [], "message": "未找到相关论文，请尝试换个描述方式。"})
                return

            yield sse("progress", {"message": f"找到 {len(papers)} 篇论文，正在补全 PDF 链接..."})
            papers = await enhance_with_unpaywall(papers)

            yield sse("progress", {"message": f"正在验证相关性..."})
            accepted, rejected = await validate_papers(papers, request.query, request.api_key)
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
async def download(url: str):
    try:
        content, content_type = await fetch_pdf_bytes(url)
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
