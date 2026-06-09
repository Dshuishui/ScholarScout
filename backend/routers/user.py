import json
import hashlib
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from database import get_db
from datetime import datetime
from models_db import User, SavedPaper, ReadingHistory, PaperChat, SearchSession
from dependencies import get_current_user

router = APIRouter()


class PaperBody(BaseModel):
    paper: dict[str, Any]


class ChatSaveBody(BaseModel):
    paper: dict[str, Any]
    messages: list[dict[str, Any]]
    pdf_text: str | None = None        # None = 不更新；空字符串/文本 = 更新
    update_pdf: bool = False           # True 时才写入 pdf_text（含清除）


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
            "pdf_text": row.pdf_text,
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
        if body.update_pdf:
            existing.pdf_text = body.pdf_text or None
        existing.updated_at = datetime.utcnow()
    else:
        db.add(PaperChat(
            user_id=user.id,
            paper_id_hash=h,
            paper_json=json.dumps(body.paper),
            messages_json=json.dumps(body.messages),
            pdf_text=body.pdf_text if body.update_pdf else None,
        ))
    await db.commit()
    return {"ok": True}


# ── 搜索快照 ────────────────────────────────────────────────────────────────

class SessionCreateBody(BaseModel):
    query: str | None = None
    keywords: list[str]
    papers: list[dict[str, Any]]


class SessionAnalysisBody(BaseModel):
    mode: str
    content: str


@router.get("/sessions")
async def get_sessions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SearchSession)
        .where(SearchSession.user_id == user.id)
        .order_by(SearchSession.created_at.desc())
        .limit(30)
    )
    return [
        {
            "id": s.id,
            "query": s.query,
            "keywords": json.loads(s.keywords_json),
            "papers": json.loads(s.papers_json),
            "analysis": json.loads(s.analysis_json) if s.analysis_json else {},
            "created_at": s.created_at.isoformat(),
        }
        for s in result.scalars()
    ]


@router.post("/sessions", status_code=201)
async def create_session(body: SessionCreateBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # 超出 30 条时删最旧的
    count_res = await db.execute(
        select(SearchSession).where(SearchSession.user_id == user.id).order_by(SearchSession.created_at.asc())
    )
    all_sessions = count_res.scalars().all()
    if len(all_sessions) >= 30:
        await db.delete(all_sessions[0])

    session = SearchSession(
        user_id=user.id,
        query=body.query,
        keywords_json=json.dumps(body.keywords, ensure_ascii=False),
        papers_json=json.dumps(body.papers, ensure_ascii=False),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return {"id": session.id}


@router.patch("/sessions/{session_id}/analysis")
async def update_session_analysis(
    session_id: int,
    body: SessionAnalysisBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SearchSession).where(SearchSession.id == session_id, SearchSession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="未找到")
    analysis = json.loads(session.analysis_json) if session.analysis_json else {}
    analysis[body.mode] = body.content
    session.analysis_json = json.dumps(analysis, ensure_ascii=False)
    await db.commit()
    return {"ok": True}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        delete(SearchSession).where(SearchSession.id == session_id, SearchSession.user_id == user.id)
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="未找到")
    return {"deleted": True}
