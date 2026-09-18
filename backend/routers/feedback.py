import asyncio
import json
import httpx
from datetime import datetime
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from database import get_db
from models_db import Feedback, User
from dependencies import get_optional_user
from services.email_service import send_feedback_notification, send_reply_notification
from services.rate_limit import client_ip

router = APIRouter()

AUTHOR_EMAIL = "dshuishui168@gmail.com"
VALID_EMOJIS = {'👍', '❤️', '😂', '🤔'}


def _parse_reactions(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


RECALL_WINDOW = 300  # 5 minutes


class FeedbackRequest(BaseModel):
    content: str = Field(min_length=1, max_length=200)
    reply_to_id: Optional[int] = None
    category: Optional[str] = 'chat'  # 'suggest' | 'bug' | 'chat'


async def _get_location(ip: str) -> Optional[str]:
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return None
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(
                f"http://ip-api.com/json/{ip}",
                params={"fields": "status,country,city", "lang": "zh-CN"},
            )
            data = r.json()
            if data.get("status") == "success":
                city = data.get("city", "")
                country = data.get("country", "")
                return f"{city} · {country}" if city else country
    except Exception:
        pass
    return None


@router.get("")
async def get_feedback(
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    current_user_id = current_user.id if current_user else None

    result = await db.execute(
        select(Feedback).order_by(Feedback.created_at.asc()).limit(100)
    )
    items = list(result.scalars())

    # 批量查询被引用的消息
    reply_ids = {item.reply_to_id for item in items if item.reply_to_id}
    reply_map: dict[int, Feedback] = {}
    if reply_ids:
        r2 = await db.execute(select(Feedback).where(Feedback.id.in_(reply_ids)))
        for row in r2.scalars():
            reply_map[row.id] = row

    # 批量查询发送者邮箱前缀
    user_ids = {item.user_id for item in items if item.user_id}
    user_name_map: dict[int, str] = {}
    if user_ids:
        u_result = await db.execute(select(User).where(User.id.in_(user_ids)))
        for u in u_result.scalars():
            if u.email:
                user_name_map[u.id] = u.email.split('@')[0]

    now = datetime.utcnow()
    return [
        {
            "id": row.id,
            "content": row.content if not row.recalled else None,
            "recalled": bool(row.recalled),
            "location": row.location,
            "is_author": bool(row.is_author),
            "is_mine": current_user_id is not None and row.user_id == current_user_id,
            "sender_name": user_name_map.get(row.user_id) if row.user_id else None,
            "category": row.category or 'chat',
            "created_at": row.created_at.isoformat(),
            "reactions": _parse_reactions(row.reactions_json),
            "can_recall": (
                current_user_id is not None
                and row.user_id == current_user_id
                and not row.recalled
                and (now - row.created_at).total_seconds() < RECALL_WINDOW
            ),
            "reply_to": (
                {
                    "id": reply_map[row.reply_to_id].id,
                    "content": (reply_map[row.reply_to_id].content or "")[:80],
                    "recalled": bool(reply_map[row.reply_to_id].recalled),
                    "is_author": bool(reply_map[row.reply_to_id].is_author),
                }
                if row.reply_to_id and row.reply_to_id in reply_map
                else None
            ),
        }
        for row in items
    ]


@router.post("", status_code=201)
async def submit_feedback(
    req: FeedbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    user_id = current_user.id if current_user else None
    is_author = bool(current_user and current_user.email == AUTHOR_EMAIL)

    location = await _get_location(client_ip(request))

    valid_categories = {'suggest', 'bug', 'chat'}
    category = req.category if req.category in valid_categories else 'chat'

    fb = Feedback(
        content=req.content.strip(),
        location=location,
        is_author=int(is_author),
        user_id=user_id,
        reply_to_id=req.reply_to_id,
        category=category,
    )
    db.add(fb)
    await db.commit()
    await db.refresh(fb)

    if not is_author:
        from services import stats
        await stats.bump(db, stats.FEEDBACK)
        asyncio.create_task(send_feedback_notification(fb.content, location, category))

    if req.reply_to_id:
        orig_res = await db.execute(select(Feedback).where(Feedback.id == req.reply_to_id))
        orig = orig_res.scalar_one_or_none()
        if orig and orig.user_id and orig.user_id != user_id:
            user_res = await db.execute(select(User).where(User.id == orig.user_id))
            orig_user = user_res.scalar_one_or_none()
            if orig_user and orig_user.email:
                asyncio.create_task(
                    send_reply_notification(orig_user.email, orig.content or "", fb.content)
                )

    return {"ok": True, "id": fb.id, "created_at": fb.created_at.isoformat()}


@router.delete("/{msg_id}", status_code=200)
async def recall_feedback(
    msg_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    if not current_user:
        raise HTTPException(status_code=401, detail="需要登录才能撤回留言")
    user_id = current_user.id

    result = await db.execute(select(Feedback).where(Feedback.id == msg_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="留言不存在")
    if msg.user_id != user_id:
        raise HTTPException(status_code=403, detail="只能撤回自己的留言")
    if msg.recalled:
        raise HTTPException(status_code=400, detail="已经撤回过了")

    elapsed = (datetime.utcnow() - msg.created_at).total_seconds()
    if elapsed > RECALL_WINDOW:
        raise HTTPException(status_code=400, detail="超过 5 分钟，无法撤回")

    msg.recalled = 1
    await db.commit()
    return {"recalled": True}


class ReactRequest(BaseModel):
    emoji: str
    action: str  # "add" | "remove"


# (留言 id, 表情) → 已点过的 IP。点赞无需登录，没有这个记录就能无限刷数量或把别人的赞减掉。
# 只存在内存里，重启后清空，对留言板这种场景足够。
_reaction_ips: dict[tuple[int, str], set[str]] = {}


@router.patch("/{msg_id}/react", status_code=200)
async def react_feedback(
    msg_id: int,
    req: ReactRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    if req.emoji not in VALID_EMOJIS or req.action not in ('add', 'remove'):
        raise HTTPException(status_code=400, detail="Invalid emoji or action")

    result = await db.execute(select(Feedback).where(Feedback.id == msg_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="留言不存在")

    reactions = _parse_reactions(msg.reactions_json)
    voters = _reaction_ips.setdefault((msg_id, req.emoji), set())
    ip = client_ip(request)
    if req.action == 'add' and ip not in voters:
        voters.add(ip)
        reactions[req.emoji] = reactions.get(req.emoji, 0) + 1
    elif req.action == 'remove' and ip in voters:
        voters.discard(ip)
        reactions[req.emoji] = max(0, reactions.get(req.emoji, 0) - 1)
    else:
        return {"reactions": reactions}  # 重复点赞或撤销别人的赞：不改数量

    msg.reactions_json = json.dumps(reactions, ensure_ascii=False)
    await db.commit()
    return {"reactions": reactions}
