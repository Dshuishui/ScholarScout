"""论文对话：用系统 Key 代付的免费额度。

用户填了自己的 Key 时，浏览器仍然直连 DeepSeek（不经过我们，省服务器带宽也更快）。
没有 Key 的用户走这里：按人计次、截断上下文、限制输出长度，成本可控。
"""
import json
from collections import defaultdict
from typing import Optional

import openai
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

import config
from database import get_db, AsyncSessionLocal
from dependencies import get_optional_user
from logging_config import get_logger
from models import Paper
from models_db import User
from services.rate_limit import rate_ok, client_ip
from services import stats
from services.trial_service import anon_status, reserve_anon_search, refund_anon_search, valid_device_id

logger = get_logger(__name__)
router = APIRouter()

TRIAL_DEVICE_HEADER = "X-Trial-Device"
CHATS_PER_HOUR = 30            # 单个用户/IP 每小时最多几条，防脚本刷
MAX_HISTORY_MESSAGES = 8
MAX_MESSAGE_CHARS = 2000
_chat_attempts: dict[str, list[float]] = defaultdict(list)


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=20000)


class PaperChatRequest(BaseModel):
    paper: Paper
    messages: list[ChatMessage] = Field(default=[], max_length=40)
    question: str = Field(min_length=1, max_length=2000)
    pdf_text: Optional[str] = Field(default=None, max_length=4_000_000)


def _deny(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _system_prompt(paper: Paper) -> str:
    lines = [
        "你是一个学术论文分析助手，请根据以下论文信息回答用户的问题。请用中文回答，简洁专业。支持 Markdown 格式输出。",
        "",
        "【论文信息】",
        f"标题：{paper.title}",
    ]
    if paper.authors:
        lines.append("作者：" + "、".join(paper.authors[:5]))
    if paper.venue:
        lines.append(f"发表于：{paper.venue}")
    if paper.published_date:
        lines.append(f"年份：{paper.published_date[:4]}")
    if paper.abstract:
        lines.append(f"\n摘要：{paper.abstract}")
    return "\n".join(lines)


def _build_messages(req: PaperChatRequest) -> list[dict]:
    msgs: list[dict] = [{"role": "system", "content": _system_prompt(req.paper)}]
    for m in req.messages[-MAX_HISTORY_MESSAGES:]:
        msgs.append({"role": m.role, "content": m.content[:MAX_MESSAGE_CHARS]})
    if req.pdf_text:
        # 免费额度下只截取开头一段全文：一篇 PDF 可能有上百万字符，整篇送进去一条对话就要几块钱
        excerpt = req.pdf_text[: config.FREE_CHAT_CONTEXT_CHARS]
        truncated = len(req.pdf_text) > len(excerpt)
        note = "（免费额度下只截取了全文开头部分；填写自己的 API Key 可基于完整原文回答）" if truncated else ""
        msgs.append({"role": "user", "content": f"【论文全文节选】{note}\n\n{excerpt}"})
        msgs.append({"role": "assistant", "content": "已收到论文内容，我会基于它回答后续问题。"})
    msgs.append({"role": "user", "content": req.question[:MAX_MESSAGE_CHARS]})
    return msgs


async def _charge_chat(http_request: Request, user: Optional[User], db: AsyncSession) -> tuple[Optional[int], int]:
    """扣一条免费对话额度，返回 (未登录时的用量记录 id, 扣减后剩余条数)。"""
    if not config.DEEPSEEK_SYSTEM_KEY:
        raise _deny(401, "key_required", "请填写自己的 DeepSeek API Key 后使用论文对话")

    if user:
        result = await db.execute(
            sa_update(User).where(User.id == user.id, User.free_chats > 0)
            .values(free_chats=User.free_chats - 1)
            .execution_options(synchronize_session=False)
        )
        await db.commit()
        if result.rowcount == 0:
            raise _deny(403, "chats_exhausted", "免费对话次数已用完，填写自己的 DeepSeek API Key 即可继续使用")
        if not rate_ok(_chat_attempts, f"user:{user.id}", limit=CHATS_PER_HOUR, window_sec=3600):
            raise _deny(429, "rate_limited", "对话太频繁，请稍后再试")
        remaining = await db.scalar(select(User.free_chats).where(User.id == user.id))
        return None, max(0, remaining or 0)

    device_id = http_request.headers.get(TRIAL_DEVICE_HEADER, "").strip()
    if not valid_device_id(device_id):
        raise _deny(401, "key_required", "请填写 DeepSeek API Key，或登录后使用免费对话")
    ip = client_ip(http_request)
    if not rate_ok(_chat_attempts, f"ip:{ip}", limit=CHATS_PER_HOUR, window_sec=3600):
        raise _deny(429, "rate_limited", "对话太频繁，请稍后再试")
    usage_id, status = await reserve_anon_search(db, device_id, ip, kind="chat")
    if usage_id is None:
        if status.remaining <= 0:
            raise _deny(403, "chats_exhausted",
                        f"免费对话次数已用完，注册账号可再得 {config.ACCOUNT_FREE_CHATS} 条")
        raise _deny(429, "chat_capacity", "今天的免费对话名额已用完，注册账号或填写自己的 Key 可继续使用")
    return usage_id, max(0, status.remaining - 1)


async def _refund_chat(usage_id: Optional[int], user_id: Optional[int]) -> None:
    try:
        async with AsyncSessionLocal() as db:
            if usage_id is not None:
                await refund_anon_search(db, usage_id)
            elif user_id is not None:
                await db.execute(
                    sa_update(User).where(User.id == user_id)
                    .values(free_chats=User.free_chats + 1)
                    .execution_options(synchronize_session=False)
                )
                await db.commit()
    except Exception as e:
        logger.warning("Refund free chat failed: %s", e)


@router.post("/paper")
async def paper_chat(
    request: PaperChatRequest,
    http_request: Request,
    optional_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """流式返回一条回答。每行一个 SSE 事件：delta（增量文本）/ quota / error。"""
    usage_id, remaining = await _charge_chat(http_request, optional_user, db)
    await stats.bump(db, stats.CHAT)
    user_id = optional_user.id if optional_user else None
    messages = _build_messages(request)

    async def generate():
        produced = False
        try:
            yield f"event: quota\ndata: {{\"remaining\": {remaining}}}\n\n"
            client = openai.AsyncOpenAI(api_key=config.DEEPSEEK_SYSTEM_KEY, base_url=config.DEEPSEEK_BASE_URL)
            stream = await client.chat.completions.create(
                model=config.DEEPSEEK_MODEL,
                messages=messages,
                stream=True,
                temperature=0.3,
                max_tokens=config.FREE_CHAT_MAX_TOKENS,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    produced = True
                    yield f"event: delta\ndata: {json.dumps({'text': delta}, ensure_ascii=False)}\n\n"
            yield "event: done\ndata: {}\n\n"
        except Exception as e:
            logger.error("Free paper chat failed: %s", e, exc_info=True)
            if not produced:
                await _refund_chat(usage_id, user_id)
            yield ("event: error\ndata: {\"message\": \"回答生成失败，请稍后重试\", "
                   f"\"refunded\": {str(not produced).lower()}}}\n\n")

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def chat_quota(http_request: Request, user: Optional[User], db: AsyncSession) -> dict:
    """给 /api/trial/status 用：当前用户还剩几条免费对话。"""
    if not config.DEEPSEEK_SYSTEM_KEY:
        return {"chats_remaining": 0, "chats_total": 0}
    if user:
        return {"chats_remaining": user.free_chats, "chats_total": config.ACCOUNT_FREE_CHATS}
    device_id = http_request.headers.get(TRIAL_DEVICE_HEADER, "").strip()
    if not valid_device_id(device_id):
        return {"chats_remaining": 0, "chats_total": config.ANON_FREE_CHATS}
    status = await anon_status(db, device_id, client_ip(http_request), kind="chat")
    return {"chats_remaining": status.remaining if status.capacity_ok else 0,
            "chats_total": config.ANON_FREE_CHATS}
