"""订阅管理 API（需登录）。"""
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models_db import Subscription, User
from dependencies import get_current_user

router = APIRouter()


class SubscriptionCreate(BaseModel):
    keywords: list[str] = Field(min_length=1, max_length=10)


class SubscriptionOut(BaseModel):
    id: int
    keywords: list[str]
    active: bool
    created_at: datetime
    last_sent: datetime | None


def _to_out(sub: Subscription) -> SubscriptionOut:
    return SubscriptionOut(
        id=sub.id,
        keywords=json.loads(sub.keywords_json),
        active=bool(sub.active),
        created_at=sub.created_at,
        last_sent=sub.last_sent,
    )


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
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # 最多 20 个订阅
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
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return _to_out(sub)


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
    await db.delete(sub)
    await db.commit()


@router.post("/subscriptions/{sub_id}/test-send")
async def test_send_subscription(
    sub_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """立即触发一次发送（搜索过去 7 天的论文），用于验证邮件配置。"""
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
