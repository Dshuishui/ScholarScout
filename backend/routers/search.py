import asyncio
import json
import logging
import weakref
from collections import defaultdict
from dataclasses import dataclass

import openai
from typing import Optional
from concurrent.futures import ThreadPoolExecutor

_index_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vector-index")

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from logging_config import get_logger
logger = get_logger(__name__)

from database import get_db, AsyncSessionLocal
from dependencies import get_optional_user
from models import SearchRequest, ParseRequest, ParsedQuery, ValidateKeyRequest
from models_db import User
from services.llm_service import classify_intent, parse_query, validate_papers, rank_accepted
from services.search_service import (
    search_all_sources, enhance_with_unpaywall, get_source_names, available_sources, deduplicate,
)
from services.download_service import fetch_pdf_with_fallback
from services.pdf_finder_service import find_pdfs_with_kimi, generate_fallback_links
from services.cache_service import get_cached_search, cache_search
from services.rate_limit import rate_ok, client_ip
from services import stats
from services.trial_service import anon_status, reserve_anon_search, refund_anon_search, valid_device_id
from services.health_monitor import source_stats
from config import (
    CORE_API_KEY, NASA_ADS_API_KEY, SERPAPI_KEY, KIMI_API_KEY,
    DEEPSEEK_BASE_URL, DEEPSEEK_MODEL, DEEPSEEK_SYSTEM_KEY,
    FREE_SEARCHES_QUOTA, ANON_TRIAL_SEARCHES, SEARCH_LIMIT_PER_SOURCE, VALIDATED_LIMIT,
)

router = APIRouter()

TRIAL_PARSE_PER_HOUR = 20  # 试用用户（系统 Key 代付）每小时最多解析次数，登录用户按账号、访客按 IP 计
TRIAL_DEVICE_HEADER = "X-Trial-Device"
PREVIEW_LIMIT = 20  # 搜索过程中先展示的原始结果条数  # 前端在 localStorage 生成的随机设备标识
_trial_parse_attempts: dict[str, list[float]] = defaultdict(list)


async def _index_papers_async(papers_dict: list[dict]) -> None:
    """Fire-and-forget: index search results into the vector store."""
    try:
        from services.vector_service import index_papers
        from services.ws_manager import manager as ws_manager
        loop = asyncio.get_event_loop()
        n = await loop.run_in_executor(_index_executor, lambda: index_papers(papers_dict))
        if n:
            logger.info("Indexed %d papers into vector store", n)
            await ws_manager.broadcast("search_indexed", {"count": n})
    except Exception as e:
        logger.warning("Vector indexing failed (non-fatal): %s", e)


# ── 谁来付 DeepSeek 的钱：用户自己的 Key / 登录用户的免费次数 / 未登录访客的体验次数 ──
#
# 出错时 detail 是 {"code", "message"}，前端按 code 给出对应引导（注册、登录、填 Key），
# 不再把所有失败都显示成"网络错误"。

def _deny(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _device_id(http_request: Request) -> Optional[str]:
    device_id = http_request.headers.get(TRIAL_DEVICE_HEADER, "").strip()
    return device_id if valid_device_id(device_id) else None


@dataclass
class _Charge:
    api_key: str
    user_id: Optional[int] = None    # 扣的是登录用户的免费次数
    usage_id: Optional[int] = None   # 扣的是未登录访客的体验次数
    remaining: Optional[int] = None  # 扣完之后还剩几次

    @property
    def is_trial(self) -> bool:
        return self.user_id is not None or self.usage_id is not None


async def _check_trial_access(http_request: Request, optional_user: Optional[User], db: AsyncSession) -> str:
    """没有自己的 Key 时，检查能否用系统 Key（只检查、不扣次数），返回系统 Key。"""
    if not DEEPSEEK_SYSTEM_KEY:
        raise _deny(401, "key_required", "请填写自己的 DeepSeek API Key 后使用")

    if optional_user:
        if optional_user.free_searches <= 0:
            raise _deny(403, "credits_exhausted", "免费搜索次数已用完，填写自己的 DeepSeek API Key 即可继续使用")
        rate_key = f"user:{optional_user.id}"
    else:
        device_id = _device_id(http_request)
        if not device_id:
            raise _deny(401, "key_required", "请填写 DeepSeek API Key，或登录后使用免费次数")
        ip = client_ip(http_request)
        status = await anon_status(db, device_id, ip)
        if status.remaining <= 0:
            raise _deny(403, "trial_exhausted", f"免费体验次数已用完，注册账号可再得 {FREE_SEARCHES_QUOTA} 次")
        if not status.capacity_ok:
            raise _deny(429, "trial_capacity", "今天的免费体验名额已经用完，注册账号或填写自己的 Key 可继续使用")
        rate_key = f"ip:{ip}"

    # parse 不扣次数，所以要单独限流，否则试用账号可以无限调用、消耗系统 Key。
    # 访客按 IP 计，多人共用出口 IP 的情况给宽一些
    limit = TRIAL_PARSE_PER_HOUR if optional_user else TRIAL_PARSE_PER_HOUR * 2
    if not rate_ok(_trial_parse_attempts, rate_key, limit=limit, window_sec=3600):
        raise _deny(429, "rate_limited", "请求过于频繁，请稍后再试")
    return DEEPSEEK_SYSTEM_KEY


async def _charge_search(
    request_api_key: Optional[str],
    http_request: Request,
    optional_user: Optional[User],
    db: AsyncSession,
) -> _Charge:
    """确定本次搜索用哪个 Key；用系统 Key 时先扣一次，搜索失败或无结果再退还。"""
    if request_api_key:
        return _Charge(api_key=request_api_key)

    if not DEEPSEEK_SYSTEM_KEY:
        raise _deny(401, "key_required", "请填写自己的 DeepSeek API Key 后使用")

    if optional_user:
        # 原子扣减（WHERE free_searches > 0 防并发超额）
        result = await db.execute(
            sa_update(User)
            .where(User.id == optional_user.id, User.free_searches > 0)
            .values(free_searches=User.free_searches - 1)
            .execution_options(synchronize_session=False)
        )
        await db.commit()
        if result.rowcount == 0:
            raise _deny(403, "credits_exhausted", "免费搜索次数已用完，填写自己的 DeepSeek API Key 即可继续使用")
        remaining = await db.scalar(select(User.free_searches).where(User.id == optional_user.id))
        return _Charge(api_key=DEEPSEEK_SYSTEM_KEY, user_id=optional_user.id, remaining=remaining)

    device_id = _device_id(http_request)
    if not device_id:
        raise _deny(401, "key_required", "请填写 DeepSeek API Key，或登录后使用免费次数")
    usage_id, status = await reserve_anon_search(db, device_id, client_ip(http_request))
    if usage_id is None:
        if status.remaining <= 0:
            raise _deny(403, "trial_exhausted", f"免费体验次数已用完，注册账号可再得 {FREE_SEARCHES_QUOTA} 次")
        raise _deny(429, "trial_capacity", "今天的免费体验名额已经用完，注册账号或填写自己的 Key 可继续使用")
    return _Charge(api_key=DEEPSEEK_SYSTEM_KEY, usage_id=usage_id, remaining=status.remaining - 1)


async def _count_search() -> None:
    """记一次"完成的搜索"。流式响应里请求级会话已不可靠，单独开一个。"""
    try:
        async with AsyncSessionLocal() as db:
            await stats.bump(db, stats.SEARCH)
    except Exception as e:
        logger.info("Search counter failed: %s", e)


async def _refund(charge: _Charge) -> None:
    """退还本次扣掉的免费次数。流式响应里请求级的 DB 会话已不可靠，单独开一个。"""
    if not charge.is_trial:
        return
    try:
        async with AsyncSessionLocal() as db:
            if charge.usage_id is not None:
                await refund_anon_search(db, charge.usage_id)
            elif charge.user_id is not None:
                await db.execute(
                    sa_update(User).where(User.id == charge.user_id)
                    .values(free_searches=User.free_searches + 1)
                    .execution_options(synchronize_session=False)
                )
                await db.commit()
    except Exception as e:
        logger.warning("Refund free search failed: %s", e)


@router.get("/trial/status")
async def trial_status(
    http_request: Request,
    optional_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """前端展示剩余免费次数用。未登录时按设备标识 + IP 计算。"""
    # 前端每次打开页面都会调这个接口，用它统计"页面打开次数"（周报用，不记录任何个人信息）
    await stats.bump(db, stats.PAGE_OPEN)
    enabled = bool(DEEPSEEK_SYSTEM_KEY)
    info = {
        "enabled": enabled,
        "anon_total": ANON_TRIAL_SEARCHES,
        "signup_bonus": FREE_SEARCHES_QUOTA if enabled else 0,
        "anon_remaining": 0,
        "capacity_ok": True,
    }
    from routers.chat import chat_quota
    info.update(await chat_quota(http_request, optional_user, db))
    if optional_user:
        info["account_remaining"] = optional_user.free_searches if enabled else 0
        return info
    device_id = _device_id(http_request)
    if enabled and device_id:
        status = await anon_status(db, device_id, client_ip(http_request))
        info["anon_remaining"] = status.remaining
        info["capacity_ok"] = status.capacity_ok
    return info


def _llm_error(e: "openai.APIStatusError", using_own_key: bool) -> HTTPException:
    """把 DeepSeek 的鉴权 / 余额错误翻译成前端能引导用户处理的错误码。"""
    if not using_own_key:
        # 系统 Key 出问题是站长的事，不能让访客去"检查 Key"
        logger.error("System DeepSeek key failed: %s %s", e.status_code, e)
        return _deny(503, "trial_unavailable", "免费体验暂时不可用，填写自己的 DeepSeek API Key 可继续使用")
    if e.status_code == 401:
        return _deny(401, "invalid_key", "DeepSeek API Key 无效或已过期，请更换 Key")
    if e.status_code == 402:
        return _deny(402, "insufficient_balance", "DeepSeek 账户余额不足，请前往 platform.deepseek.com 充值")
    if e.status_code == 429:
        return _deny(429, "rate_limited", "DeepSeek 调用太频繁，请稍后再试")
    return _deny(502, "llm_unavailable", "AI 服务暂时不可用，请稍后重试")


def _refund_note(charge: _Charge) -> dict:
    """退还次数后告诉前端最新剩余次数。"""
    if not charge.is_trial or charge.remaining is None:
        return {}
    return {"refunded": True, "remaining": charge.remaining + 1}


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/parse")
async def parse(
    request: ParseRequest,
    http_request: Request,
    optional_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Phase 1: 意图识别 + 关键词提取，返回普通 JSON 供前端展示确认。
    注意：parse 阶段不扣减免费额度，只在 search 阶段扣减一次。"""
    api_key = request.api_key or await _check_trial_access(http_request, optional_user, db)
    using_own_key = bool(request.api_key)

    history = [{"role": m.role, "content": m.content} for m in request.messages]
    try:
        intent = await classify_intent(request.query, api_key, history)
        if intent.get("intent") == "chat":
            return {"intent": "chat", "reply": intent.get("reply", "请问有什么可以帮您？")}
        parsed = await parse_query(request.query, api_key, history)
    except openai.APIStatusError as e:
        raise _llm_error(e, using_own_key)
    except openai.APIConnectionError:
        raise _deny(502, "llm_unavailable", "AI 服务连接失败，请稍后重试")
    return {
        "intent": "search",
        "keywords": parsed.keywords,
        "date_from": parsed.date_from,
        "date_to": parsed.date_to,
        "domains": parsed.domains,
    }


@router.post("/search")
async def search(
    request: SearchRequest,
    http_request: Request,
    optional_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Phase 2: 执行搜索 + 验证，SSE 流式推送进度和结果。
    若 request.keywords 已提供，跳过意图识别和关键词解析。
    无 api_key 时走试用模式（登录用户的免费次数，或未登录访客的体验次数），扣减后使用系统 Key。"""
    # 在流式响应开始前完成鉴权和扣减（避免 DB session 在 SSE 流中生命周期问题）
    charge = await _charge_search(request.api_key, http_request, optional_user, db)
    api_key = charge.api_key
    if charge.is_trial:
        # 系统 Key 代付时不接受放大的候选/结果数量，单次搜索的大模型花费保持在默认水平
        request.limit_per_source = min(request.limit_per_source, SEARCH_LIMIT_PER_SOURCE)
        request.validated_limit = min(request.validated_limit, VALIDATED_LIMIT)

    async def generate():
        result_delivered = False  # 结果已发给前端后再出错（如 PDF 深度查找），不退还次数
        try:
            if charge.is_trial:
                yield sse("quota", {"remaining": charge.remaining, "kind": "account" if charge.user_id else "anon"})
            history = [{"role": m.role, "content": m.content} for m in request.messages]

            if request.keywords:
                # 前端已确认关键词，直接构造 ParsedQuery
                parsed = ParsedQuery(
                    keywords=request.keywords,
                    date_from=request.date_from,
                    date_to=request.date_to,
                    max_results=request.limit_per_source,
                    domains=request.domains or [],
                )
            else:
                # 旧路径：兼容不带关键词的调用
                intent = await classify_intent(request.query, api_key, history)
                if intent.get("intent") == "chat":
                    await _refund(charge)
                    yield sse("chat", {"message": intent.get("reply", "请问有什么可以帮您？")})
                    return
                yield sse("progress", {"message": "正在理解您的需求..."})
                parsed = await parse_query(request.query, api_key, history)

            kw_str = "、".join(parsed.keywords)
            yield sse("progress", {"message": f"正在搜索关键词：{kw_str}..."})

            # 缓存键用实际要查的数据源（已含按领域选源的结果），避免复用未选源时的缓存
            source_names = get_source_names(request.sources, parsed.domains)

            # Check Redis cache before hitting external APIs
            cached_papers = await get_cached_search(
                parsed.keywords, source_names,
                parsed.date_from or "", parsed.date_to or "",
            )
            if cached_papers:
                # 命中缓存不产生任何大模型调用，不该扣用户的免费次数
                await _refund(charge)
                yield sse("cache_hit", {"message": f"已从缓存加载 {len(cached_papers)} 篇论文"})
                yield sse("done", {
                    "papers": cached_papers,
                    "rejected_papers": [],
                    "message": f"从缓存加载 {len(cached_papers)} 篇相关论文。",
                    **_refund_note(charge),
                })
                return

            # Notify frontend which sources will be searched
            yield sse("search_start", {
                "sources": source_names,
                "date_from": parsed.date_from,
                "date_to": parsed.date_to,
            })

            # Collect per-source completion events via queue
            source_queue: asyncio.Queue = asyncio.Queue()
            collected: list = []          # 已回来的原始论文（未去重）
            preview_sent = 0              # 上次推给前端的预览条数

            async def on_source_done(name: str, count: int, papers: list) -> None:
                collected.extend(papers)
                await source_queue.put({"source": name, "count": count})

            search_task = asyncio.create_task(
                search_all_sources(parsed, limit_per_source=request.limit_per_source,
                                   sources=request.sources, on_source_done=on_source_done)
            )

            def preview_payload() -> dict:
                """搜索还没结束时先给前端一批结果，避免用户对着进度条干等 1 分钟。
                这批是未经 AI 筛选的原始结果，按引用数排，最多 PREVIEW_LIMIT 篇。"""
                merged = deduplicate(collected)
                merged.sort(key=lambda p: p.citations, reverse=True)
                return {"papers": [p.model_dump() for p in merged[:PREVIEW_LIMIT]], "total": len(merged)}

            # Drain progress events while search runs
            while not search_task.done():
                try:
                    item = source_queue.get_nowait()
                    yield sse("source_done", item)
                    if len(collected) > preview_sent:
                        preview_sent = len(collected)
                        yield sse("partial", preview_payload())
                except asyncio.QueueEmpty:
                    await asyncio.sleep(0.05)

            # Drain any remaining events
            while not source_queue.empty():
                yield sse("source_done", source_queue.get_nowait())
            if len(collected) > preview_sent:
                yield sse("partial", preview_payload())

            papers = await search_task
            if not papers:
                await _refund(charge)
                yield sse("done", {"papers": [], "message": "未找到相关论文，请尝试换个描述方式。",
                                   **_refund_note(charge)})
                return

            yield sse("progress", {"message": f"找到 {len(papers)} 篇论文，正在补全 PDF 链接..."})
            papers = await enhance_with_unpaywall(papers)

            yield sse("progress", {"message": f"正在验证相关性..."})
            accepted, rejected = await validate_papers(papers, request.query, api_key)
            final = rank_accepted(accepted)[:request.validated_limit]

            await _count_search()
            papers_dict = [p.model_dump() for p in final]
            rejected_dict = [p.model_dump() for p in rejected]
            refund_info = {}
            if not final:
                # 一篇相关的都没筛出来，这次不算次数
                await _refund(charge)
                refund_info = _refund_note(charge)
            yield sse("done", {
                "papers": papers_dict,
                "rejected_papers": rejected_dict,
                "message": f"为您找到 {len(final)} 篇相关论文。",
                **refund_info,
            })
            result_delivered = True

            # 异步向量索引（不阻塞，失败不影响搜索）
            asyncio.create_task(_index_papers_async(papers_dict))

            # Store validated results in Redis (non-blocking)
            asyncio.create_task(cache_search(
                parsed.keywords, source_names,
                papers_dict, parsed.date_from or "", parsed.date_to or "",
            ))

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
            if not result_delivered:
                await _refund(charge)
            yield sse("error", {"message": "搜索出错，请稍后重试。", **({} if result_delivered else _refund_note(charge))})

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


@router.get("/sources")
async def sources():
    """界面上可勾选的数据源。没配 key 的源（CORE / NASA ADS / Google Scholar）永远返回 0 篇，不列出来。"""
    return {"sources": available_sources()}


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
        # 最近 6 小时各源实际返回情况：calls_6h 次调用里 nonzero_6h 次有结果（进程内统计，重启清零）
        "source_activity": source_stats(),
    }


MAX_CONCURRENT_DOWNLOADS = 4
_download_slots: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


def _download_slot() -> asyncio.Semaphore:
    """每个 PDF 最多 50 MB 读进内存，nginx 又允许 50 个并发，不限并发会撑爆 3.6 GB 内存的服务器。"""
    loop = asyncio.get_running_loop()
    if loop not in _download_slots:
        _download_slots[loop] = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
    return _download_slots[loop]


@router.get("/download")
async def download(
    url: str,
    doi: str | None = None,
    paper_id: str | None = None,
):
    try:
        async with _download_slot():
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
