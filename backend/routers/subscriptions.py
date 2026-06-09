"""订阅管理 API（需登录）。"""
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db, AsyncSessionLocal
from models_db import Subscription, SubscriptionQueueItem, User
from dependencies import get_current_user

router = APIRouter()


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
    except Exception:
        title = "(解析错误)"
        url = source = year = citations = None
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
    if len(count_result.scalars().all()) >= 20:
        raise HTTPException(status_code=400, detail="最多同时订阅 20 个关键词组合")

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
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Subscription).where(Subscription.id == sub_id)
        )
        sub = result.scalar_one_or_none()
        if sub:
            await populate_queue(sub, db, now, search_days=30, max_add=30)


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

    from scheduler import _process_subscription
    now = datetime.now(timezone.utc)
    outcome = await _process_subscription(sub, current_user.email, now, force_days=7)
    return outcome
