import asyncio
import json
import httpx
from datetime import datetime
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from database import get_db
from models_db import Feedback, User
from services.auth_service import decode_token
from services.email_service import send_feedback_notification, send_reply_notification
from jose import JWTError

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
optional_bearer = HTTPBearer(auto_error=False)


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
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_bearer),
):
    current_user_id = None
    if credentials:
        try:
            current_user_id = decode_token(credentials.credentials)
        except Exception:
            pass

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
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_bearer),
):
    is_author = False
    user_id = None
    if credentials:
        try:
            uid = decode_token(credentials.credentials)
            user_id = uid
            res = await db.execute(select(User).where(User.id == uid))
            user = res.scalar_one_or_none()
            if user and user.email == AUTHOR_EMAIL:
                is_author = True
        except (JWTError, Exception):
            pass

    ip = (
        request.headers.get("X-Real-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.client.host
    )
    location = await _get_location(ip)

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
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_bearer),
):
    if not credentials:
        raise HTTPException(status_code=401, detail="需要登录才能撤回留言")
    try:
        user_id = decode_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=401, detail="无效的身份凭证")

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


@router.patch("/{msg_id}/react", status_code=200)
async def react_feedback(
    msg_id: int,
    req: ReactRequest,
    db: AsyncSession = Depends(get_db),
):
    if req.emoji not in VALID_EMOJIS or req.action not in ('add', 'remove'):
        raise HTTPException(status_code=400, detail="Invalid emoji or action")

    result = await db.execute(select(Feedback).where(Feedback.id == msg_id))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="留言不存在")

    reactions = _parse_reactions(msg.reactions_json)
    count = reactions.get(req.emoji, 0)
    reactions[req.emoji] = max(0, count + (1 if req.action == 'add' else -1))
    msg.reactions_json = json.dumps(reactions, ensure_ascii=False)
    await db.commit()
    return {"reactions": reactions}
