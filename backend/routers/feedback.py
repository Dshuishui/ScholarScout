from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models_db import Feedback

router = APIRouter()


class FeedbackRequest(BaseModel):
    content: str = Field(min_length=1, max_length=200)


@router.get("")
async def get_feedback(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Feedback).order_by(Feedback.created_at.desc()).limit(50)
    )
    return [
        {"id": row.id, "content": row.content, "created_at": row.created_at.isoformat()}
        for row in result.scalars()
    ]


@router.post("", status_code=201)
async def submit_feedback(req: FeedbackRequest, db: AsyncSession = Depends(get_db)):
    db.add(Feedback(content=req.content.strip()))
    await db.commit()
    return {"ok": True}
