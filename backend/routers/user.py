import json
import hashlib
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from database import get_db
from datetime import datetime
from models_db import User, SavedPaper, ReadingHistory, PaperChat
from dependencies import get_current_user

router = APIRouter()


class PaperBody(BaseModel):
    paper: dict[str, Any]


class ChatSaveBody(BaseModel):
    paper: dict[str, Any]
    messages: list[dict[str, Any]]


def _paper_hash(paper: dict) -> str:
    key = paper.get("doi") or paper.get("paper_id") or paper.get("title") or ""
    return hashlib.sha256(key.strip().lower().encode()).hexdigest()[:32]


@router.get("/saved")
async def get_saved(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SavedPaper)
        .where(SavedPaper.user_id == user.id)
        .order_by(SavedPaper.saved_at.desc())
    )
    return [{"id": row.id, "paper_id_hash": row.paper_id_hash, "paper": json.loads(row.paper_json)}
            for row in result.scalars()]


@router.post("/saved", status_code=201)
async def save_paper(body: PaperBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    h = _paper_hash(body.paper)
    existing = await db.execute(
        select(SavedPaper).where(SavedPaper.user_id == user.id, SavedPaper.paper_id_hash == h)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="已收藏")
    db.add(SavedPaper(user_id=user.id, paper_id_hash=h, paper_json=json.dumps(body.paper)))
    await db.commit()
    return {"saved": True, "paper_id_hash": h}


@router.delete("/saved/{paper_hash}")
async def unsave_paper(paper_hash: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        delete(SavedPaper).where(SavedPaper.user_id == user.id, SavedPaper.paper_id_hash == paper_hash)
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="未找到")
    return {"deleted": True}


@router.get("/history")
async def get_history(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReadingHistory)
        .where(ReadingHistory.user_id == user.id)
        .order_by(ReadingHistory.viewed_at.desc())
        .limit(100)
    )
    return [json.loads(row.paper_json) for row in result.scalars()]


@router.post("/history", status_code=201)
async def add_history(body: PaperBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    db.add(ReadingHistory(user_id=user.id, paper_json=json.dumps(body.paper)))
    await db.commit()
    return {"recorded": True}


# ── AI 对话记录（去重，每篇论文保留最新一条）──────────────────────────────

@router.get("/chats")
async def get_chats(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PaperChat)
        .where(PaperChat.user_id == user.id)
        .order_by(PaperChat.updated_at.desc())
        .limit(50)
    )
    return [
        {
            "paper_id_hash": row.paper_id_hash,
            "paper": json.loads(row.paper_json),
            "messages": json.loads(row.messages_json),
            "updated_at": row.updated_at.isoformat(),
        }
        for row in result.scalars()
    ]


@router.post("/chats", status_code=201)
async def save_chat(body: ChatSaveBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    h = _paper_hash(body.paper)
    result = await db.execute(
        select(PaperChat).where(PaperChat.user_id == user.id, PaperChat.paper_id_hash == h)
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.paper_json = json.dumps(body.paper)
        existing.messages_json = json.dumps(body.messages)
        existing.updated_at = datetime.utcnow()
    else:
        db.add(PaperChat(
            user_id=user.id,
            paper_id_hash=h,
            paper_json=json.dumps(body.paper),
            messages_json=json.dumps(body.messages),
        ))
    await db.commit()
    return {"ok": True}
