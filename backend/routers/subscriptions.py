"""订阅管理 API（需登录）。"""
import asyncio
import html
import json
from collections import defaultdict
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db, AsyncSessionLocal
from models_db import Subscription, SubscriptionQueueItem, User
from dependencies import get_current_user
from services.auth_service import decode_unsubscribe_token, TokenError
from services.rate_limit import rate_ok

router = APIRouter()

# ─── 成本控制 ───────────────────────────────────────────────
# 每次建订阅、刷新队列都会跑一轮全数据源搜索 + 大模型筛选，测试发送还会发邮件。
# 不设限的话一个账号就能耗光 OpenAlex 每天的免费额度（无 key 时约 100 次）和系统 DeepSeek Key。
MAX_SUBSCRIPTIONS = 10
DAY = 86400
CREATE_PER_DAY = 10
REFRESH_PER_DAY = 5
TEST_SEND_PER_DAY = 3
_create_attempts: dict[str, list[float]] = defaultdict(list)
_refresh_attempts: dict[str, list[float]] = defaultdict(list)
_test_send_attempts: dict[str, list[float]] = defaultdict(list)

# 后台补充队列串行执行：一次性建很多订阅时不会同时对外发出大量搜索请求
_populate_locks: dict[asyncio.AbstractEventLoop, asyncio.Lock] = {}


def _populate_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    if loop not in _populate_locks:
        _populate_locks.clear()  # 只保留当前事件循环的锁（测试里每个用例都是新循环）
        _populate_locks[loop] = asyncio.Lock()
    return _populate_locks[loop]


# ─── Pydantic 模型 ──────────────────────────────────────────

class SubscriptionCreate(BaseModel):
    keywords: list[str] = Field(min_length=1, max_length=10)


class DailyLimitUpdate(BaseModel):
    daily_limit: int = Field(ge=1, le=10)


class SubscriptionOut(BaseModel):
    id: int
    keywords: list[str]
    active: bool
    created_at: datetime
    last_sent: datetime | None
    daily_limit: int


class QueueItemOut(BaseModel):
    id: int
    paper_title: str
    paper_url: str | None
    paper_id: str | None
    planned_date: str   # YYYY-MM-DD
    sent_at: datetime | None
    source: str | None = None
    year: str | None = None
    citations: int | None = None
    abstract: str | None = None


def _to_out(sub: Subscription) -> SubscriptionOut:
    return SubscriptionOut(
        id=sub.id,
        keywords=json.loads(sub.keywords_json),
        active=bool(sub.active),
        created_at=sub.created_at,
        last_sent=sub.last_sent,
        daily_limit=sub.daily_limit or 1,
    )


def _queue_item_to_out(item: SubscriptionQueueItem) -> QueueItemOut:
    try:
        data = json.loads(item.paper_json)
        title = data.get("title", "(无标题)")
        url = data.get("url") or data.get("pdf_url")
        source = data.get("source") or None
        year = (data.get("published_date") or "")[:4] or None
        citations = data.get("citations") or None
        raw_abstract = data.get("abstract") or None
        abstract = raw_abstract[:300] + "…" if raw_abstract and len(raw_abstract) > 300 else raw_abstract
    except Exception:
        title = "(解析错误)"
        url = source = year = citations = abstract = None
    return QueueItemOut(
        id=item.id,
        paper_title=title,
        paper_url=url,
        paper_id=item.paper_id,
        planned_date=item.planned_date,
        sent_at=item.sent_at,
        source=source,
        year=year,
        citations=citations,
        abstract=abstract,
    )


# ─── 列表 / 创建 / 删除 ────────────────────────────────────

@router.get("/subscriptions", response_model=list[SubscriptionOut])
async def list_subscriptions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == current_user.id)
        .order_by(Subscription.created_at.desc())
    )
    return [_to_out(s) for s in result.scalars().all()]


@router.post("/subscriptions", response_model=SubscriptionOut, status_code=201)
async def create_subscription(
    body: SubscriptionCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count_result = await db.execute(
        select(Subscription).where(Subscription.user_id == current_user.id)
    )
    if len(count_result.scalars().all()) >= MAX_SUBSCRIPTIONS:
        raise HTTPException(status_code=400, detail=f"最多同时订阅 {MAX_SUBSCRIPTIONS} 个关键词组合")
    if not rate_ok(_create_attempts, str(current_user.id), limit=CREATE_PER_DAY, window_sec=DAY):
        raise HTTPException(status_code=429, detail="今天创建订阅的次数已达上限，请明天再试")

    keywords = [kw.strip() for kw in body.keywords if kw.strip()]
    sub = Subscription(
        user_id=current_user.id,
        keywords_json=json.dumps(keywords, ensure_ascii=False),
        active=True,
        daily_limit=1,
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)

    # 后台异步填充推送队列（不阻塞 API 响应）
    background_tasks.add_task(_bg_populate_queue, sub.id)

    return _to_out(sub)


async def _bg_populate_queue(sub_id: int) -> None:
    """后台任务：为新创建的订阅填充推送队列。"""
    from scheduler import populate_queue
    from services.ws_manager import manager as ws_manager
    async with _populate_lock():
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Subscription).where(Subscription.id == sub_id)
            )
            sub = result.scalar_one_or_none()
            if sub:
                added = await populate_queue(sub, db, now, search_days=30, max_add=30)
                client_key = f"user:{sub.user_id}"
                await ws_manager.send(client_key, "subscription_ready", {
                    "sub_id": sub_id,
                    # 以前写成 sub.keywords（模型里没有这个属性），抛异常导致这条通知从来没发出去过
                    "keywords": json.loads(sub.keywords_json),
                    "added": added if isinstance(added, int) else 0,
                })


@router.delete("/subscriptions/{sub_id}", status_code=204)
async def delete_subscription(
    sub_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription).where(
            Subscription.id == sub_id,
            Subscription.user_id == current_user.id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="订阅不存在")
    # 删除队列项
    queue_result = await db.execute(
        select(SubscriptionQueueItem).where(SubscriptionQueueItem.subscription_id == sub_id)
    )
    for item in queue_result.scalars().all():
        await db.delete(item)
    await db.delete(sub)
    await db.commit()


# ─── 队列查询 & 刷新 ────────────────────────────────────────

@router.get("/subscriptions/{sub_id}/queue", response_model=list[QueueItemOut])
async def get_subscription_queue(
    sub_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回该订阅的全部队列项（已发 + 待发），按 planned_date 升序。"""
    sub_result = await db.execute(
        select(Subscription).where(
            Subscription.id == sub_id,
            Subscription.user_id == current_user.id,
        )
    )
    if not sub_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="订阅不存在")

    items_result = await db.execute(
        select(SubscriptionQueueItem)
        .where(SubscriptionQueueItem.subscription_id == sub_id)
        .order_by(SubscriptionQueueItem.planned_date.asc())
    )
    return [_queue_item_to_out(i) for i in items_result.scalars().all()]


@router.post("/subscriptions/{sub_id}/refresh-queue")
async def refresh_subscription_queue(
    sub_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """重新搜索并追加新论文到队列。后台执行，立即返回。"""
    sub_result = await db.execute(
        select(Subscription).where(
            Subscription.id == sub_id,
            Subscription.user_id == current_user.id,
        )
    )
    sub = sub_result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="订阅不存在")
    if not rate_ok(_refresh_attempts, str(current_user.id), limit=REFRESH_PER_DAY, window_sec=DAY):
        raise HTTPException(status_code=429, detail="今天刷新队列的次数已达上限，请明天再试")

    background_tasks.add_task(_bg_populate_queue, sub_id)
    return {"message": "队列刷新已在后台启动，稍后刷新页面查看"}


# ─── 每天推送篇数 ───────────────────────────────────────────

@router.patch("/subscriptions/{sub_id}/daily-limit", response_model=SubscriptionOut)
async def update_daily_limit(
    sub_id: int,
    body: DailyLimitUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription).where(
            Subscription.id == sub_id,
            Subscription.user_id == current_user.id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="订阅不存在")
    sub.daily_limit = body.daily_limit
    await db.commit()
    await db.refresh(sub)
    return _to_out(sub)


# ─── Toggle / Test-send ─────────────────────────────────────

@router.patch("/subscriptions/{sub_id}/toggle", response_model=SubscriptionOut)
async def toggle_subscription(
    sub_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Subscription).where(
            Subscription.id == sub_id,
            Subscription.user_id == current_user.id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="订阅不存在")
    sub.active = not sub.active
    await db.commit()
    await db.refresh(sub)
    return _to_out(sub)


@router.post("/subscriptions/{sub_id}/test-send")
async def test_send_subscription(
    sub_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """立即触发一次发送（搜索过去 7 天的论文，不影响队列），用于验证邮件配置。"""
    result = await db.execute(
        select(Subscription).where(
            Subscription.id == sub_id,
            Subscription.user_id == current_user.id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="订阅不存在")
    if not rate_ok(_test_send_attempts, str(current_user.id), limit=TEST_SEND_PER_DAY, window_sec=DAY):
        raise HTTPException(status_code=429, detail="今天测试发送的次数已达上限，请明天再试")

    from scheduler import _process_subscription
    now = datetime.now(timezone.utc)
    outcome = await _process_subscription(sub, current_user.email, now, force_days=7)
    return outcome


# ─── 邮件一键退订（免登录）────────────────────────────────────

def _unsubscribe_page(title: str, body: str, status_code: int = 200) -> HTMLResponse:
    page = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · ScholarScout</title></head>
<body style="font-family:-apple-system,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#111827;">
<div style="font-size:20px;font-weight:700;color:#4f46e5;margin-bottom:24px;">ScholarScout</div>
<h1 style="font-size:18px;margin:0 0 12px;">{title}</h1>
{body}
</body></html>"""
    return HTMLResponse(page, status_code=status_code)


async def _load_sub_from_token(token: str, db: AsyncSession) -> Subscription | None:
    try:
        sub_id = decode_unsubscribe_token(token)
    except (TokenError, ValueError):
        return None
    result = await db.execute(select(Subscription).where(Subscription.id == sub_id))
    return result.scalar_one_or_none()


_INVALID_LINK = ("链接无效", '<p style="color:#6b7280;">退订链接无效或订阅已被删除。</p>')


@router.get("/subscriptions/unsubscribe", response_class=HTMLResponse)
async def unsubscribe_confirm(token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """展示确认页，不直接退订：企业邮箱的安全网关会预先访问邮件里的链接，GET 改状态会误退订。"""
    sub = await _load_sub_from_token(token, db)
    if not sub:
        return _unsubscribe_page(*_INVALID_LINK, status_code=400)
    kw = html.escape(" · ".join(json.loads(sub.keywords_json)))
    if not sub.active:
        return _unsubscribe_page("已退订", f'<p style="color:#6b7280;">订阅「{kw}」已停止推送。</p>')
    body = f"""<p style="color:#374151;line-height:1.7;">确定不再接收订阅「{kw}」的每日论文推送吗？</p>
<form method="post" action="?token={html.escape(token)}">
<button type="submit" style="background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:10px 20px;font-size:14px;cursor:pointer;">确认退订</button>
</form>"""
    return _unsubscribe_page("退订确认", body)


@router.post("/subscriptions/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str = Query(...), db: AsyncSession = Depends(get_db)):
    """确认页的按钮和邮件客户端的一键退订（List-Unsubscribe-Post）都走这里。"""
    sub = await _load_sub_from_token(token, db)
    if not sub:
        return _unsubscribe_page(*_INVALID_LINK, status_code=400)
    sub.active = False
    await db.commit()
    kw = html.escape(" · ".join(json.loads(sub.keywords_json)))
    return _unsubscribe_page(
        "已退订",
        f'<p style="color:#374151;line-height:1.7;">订阅「{kw}」已停止推送，之后不会再收到这封日报。</p>'
        '<p style="color:#6b7280;font-size:13px;">想重新订阅，可以登录 ScholarScout 在订阅管理里重新开启。</p>',
    )
