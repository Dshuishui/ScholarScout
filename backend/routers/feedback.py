import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from database import get_db
from models_db import Feedback, User
from services.auth_service import decode_token
from jose import JWTError

router = APIRouter()

AUTHOR_EMAIL = "dshuishui168@gmail.com"
optional_bearer = HTTPBearer(auto_error=False)


class FeedbackRequest(BaseModel):
    content: str = Field(min_length=1, max_length=200)


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
async def get_feedback(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Feedback).order_by(Feedback.created_at.asc()).limit(50)
    )
    return [
        {
            "id": row.id,
            "content": row.content,
            "location": row.location,
            "is_author": bool(row.is_author),
            "created_at": row.created_at.isoformat(),
        }
        for row in result.scalars()
    ]


@router.post("", status_code=201)
async def submit_feedback(
    req: FeedbackRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_bearer),
):
    # 判断是否作者
    is_author = False
    if credentials:
        try:
            user_id = decode_token(credentials.credentials)
            result = await db.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user and user.email == AUTHOR_EMAIL:
                is_author = True
        except (JWTError, Exception):
            pass

    # IP 定位
    ip = (
        request.headers.get("X-Real-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.client.host
    )
    location = await _get_location(ip)

    db.add(Feedback(content=req.content.strip(), location=location, is_author=int(is_author)))
    await db.commit()
    return {"ok": True}
