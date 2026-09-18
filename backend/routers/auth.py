import json
import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete as sa_delete, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models_db import (
    User, PasswordResetToken, SavedPaper, ReadingHistory, PaperChat, SearchSession,
    Subscription, SubscriptionQueueItem, Feedback,
)
from services.auth_service import hash_password, verify_password, create_access_token
from services.email_service import send_verification_email, send_reset_password_email
from dependencies import get_current_user
from config import FREE_SEARCHES_QUOTA, APP_BASE_URL, DEEPSEEK_SYSTEM_KEY
from services.rate_limit import rate_ok, client_ip

router = APIRouter()

# ── 内存限流（小规模部署足够，生产级应用换 Redis）──────────────────────────────
# 格式：{ key: [timestamp, ...] }
_register_attempts: dict[str, list[float]] = defaultdict(list)  # IP → 注册时间戳
_login_failures: dict[str, list[float]] = defaultdict(list)     # IP → 登录失败时间戳
_resend_attempts: dict[str, list[float]] = defaultdict(list)    # email → 重发时间戳
_reset_attempts: dict[str, list[float]] = defaultdict(list)     # IP → 重置密码请求时间戳

_rate_ok = rate_ok
_get_ip = client_ip


# ── Pydantic 模型 ─────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=100)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=100)

class ResendRequest(BaseModel):
    email: EmailStr

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=1, max_length=100)
    new_password: str = Field(min_length=8, max_length=100)


# ── 辅助：生成验证 token ───────────────────────────────────────────────────────

def _make_verify_token() -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)          # 256-bit 熵，暴力破解不可行
    expires = datetime.utcnow() + timedelta(hours=24)
    return token, expires


# ── 路由 ──────────────────────────────────────────────────────────────────────

@router.post("/register")
async def register(req: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    # IP 限流：每 IP 每小时最多 5 次注册尝试
    ip = _get_ip(request)
    if not _rate_ok(_register_attempts, ip, limit=5, window_sec=3600):
        raise HTTPException(status_code=429, detail="注册请求过于频繁，请稍后再试")

    result = await db.execute(select(User).where(User.email == req.email))
    existing = result.scalar_one_or_none()
    if existing:
        if existing.is_verified:
            raise HTTPException(status_code=400, detail="邮箱已注册")
        # 已注册但未验证：重新发一封验证邮件。按收件地址限流，
        # 否则换 IP 反复注册同一邮箱就能借我们的发件邮箱轰炸别人，发件邮箱被封后注册/找回密码全部失效
        if not _rate_ok(_resend_attempts, req.email.lower(), limit=3, window_sec=3600):
            raise HTTPException(status_code=429, detail="发送过于频繁，请 1 小时后再试")
        token, expires = _make_verify_token()
        await db.execute(
            sa_update(User)
            .where(User.id == existing.id)
            .values(verify_token=token, verify_token_expires=expires)
        )
        await db.commit()
        verify_url = f"{APP_BASE_URL}/?verify={token}"
        await send_verification_email(existing.email, verify_url)
        return {"message": "该邮箱已注册但尚未验证，验证邮件已重新发送，请查收"}

    token, expires = _make_verify_token()
    user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        is_verified=False,
        verify_token=token,
        verify_token_expires=expires,
        free_searches=0,
    )
    db.add(user)
    await db.commit()

    verify_url = f"{APP_BASE_URL}/?verify={token}"
    await send_verification_email(req.email, verify_url)
    return {"message": "注册成功！验证邮件已发送，请在 24 小时内点击邮件中的链接完成验证"}


@router.get("/verify-email")
async def verify_email(token: str, db: AsyncSession = Depends(get_db)):
    """点击邮件链接后调用。验证成功直接返回 JWT，前端自动登录。"""
    if not token or len(token) > 100:
        raise HTTPException(status_code=400, detail="无效的验证链接")

    result = await db.execute(select(User).where(User.verify_token == token))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=400, detail="验证链接无效或已使用")
    if user.is_verified:
        raise HTTPException(status_code=400, detail="邮箱已完成验证，请直接登录")
    if user.verify_token_expires and user.verify_token_expires < datetime.utcnow():
        raise HTTPException(status_code=400, detail="验证链接已过期，请重新申请")

    # 原子更新：激活账号 + 清除 token + 赋予免费额度
    await db.execute(
        sa_update(User)
        .where(User.id == user.id)
        .values(
            is_verified=True,
            verify_token=None,
            verify_token_expires=None,
            free_searches=FREE_SEARCHES_QUOTA if DEEPSEEK_SYSTEM_KEY else 0,
        )
    )
    await db.commit()

    from services import stats
    await stats.bump(db, stats.REGISTER)

    access_token = create_access_token(user.id, user.token_version or 0)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "free_searches": FREE_SEARCHES_QUOTA if DEEPSEEK_SYSTEM_KEY else 0,
        "message": f"邮箱验证成功！已获得 {FREE_SEARCHES_QUOTA} 次免费搜索额度",
    }


@router.post("/login")
async def login(req: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    ip = _get_ip(request)

    # 先检查限流，再查库（防枚举 + 防暴力）
    failures = _login_failures[ip]
    now = time.time()
    _login_failures[ip] = [t for t in failures if now - t < 900]
    if len(_login_failures[ip]) >= 10:
        raise HTTPException(status_code=429, detail="登录尝试过于频繁，请 15 分钟后再试")

    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.password_hash):
        _login_failures[ip].append(now)
        raise HTTPException(status_code=401, detail="邮箱或密码错误")

    if not user.is_verified:
        raise HTTPException(
            status_code=403,
            detail="邮箱尚未验证，请查收验证邮件后再登录（可重新发送）",
        )

    return {
        "access_token": create_access_token(user.id, user.token_version or 0),
        "token_type": "bearer",
    }


@router.post("/resend-verification")
async def resend_verification(req: ResendRequest, db: AsyncSession = Depends(get_db)):
    # 邮箱维度限流：同一邮箱每小时最多重发 3 次
    if not _rate_ok(_resend_attempts, req.email.lower(), limit=3, window_sec=3600):
        raise HTTPException(status_code=429, detail="发送过于频繁，请 1 小时后再试")

    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()

    # 无论用户存不存在都返回相同文案（防枚举）
    if not user or user.is_verified:
        return {"message": "如果该邮箱存在且尚未验证，验证邮件已重新发送"}

    token, expires = _make_verify_token()
    await db.execute(
        sa_update(User)
        .where(User.id == user.id)
        .values(verify_token=token, verify_token_expires=expires)
    )
    await db.commit()

    verify_url = f"{APP_BASE_URL}/?verify={token}"
    await send_verification_email(user.email, verify_url)
    return {"message": "如果该邮箱存在且尚未验证，验证邮件已重新发送"}


@router.post("/forgot-password")
async def forgot_password(
    req: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = _get_ip(request)
    if not _rate_ok(_reset_attempts, ip, limit=3, window_sec=3600):
        raise HTTPException(status_code=429, detail="请求过于频繁，请 1 小时后再试")

    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()

    # 无论用户存不存在都返回相同文案（防枚举）
    if not user or not user.is_verified:
        return {"message": "如果该邮箱已注册，重置链接已发送，请查收"}

    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(hours=1)
    db.add(PasswordResetToken(user_id=user.id, token=token, expires_at=expires))
    await db.commit()

    reset_url = f"{APP_BASE_URL}/?reset={token}"
    import asyncio
    asyncio.create_task(send_reset_password_email(user.email, reset_url))
    return {"message": "如果该邮箱已注册，重置链接已发送，请查收"}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    if not req.token or len(req.token) > 100:
        raise HTTPException(status_code=400, detail="无效的重置链接")

    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token == req.token)
    )
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=400, detail="重置链接无效或已使用")
    if record.used:
        raise HTTPException(status_code=400, detail="重置链接已使用，请重新申请")
    if record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="重置链接已过期（有效期 1 小时），请重新申请")

    user_res = await db.execute(select(User).where(User.id == record.user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="用户不存在")

    user.password_hash = hash_password(req.new_password)
    # 版本号 +1：重置前签发的所有登录凭证立即失效（比如密码泄露后别人已经登录的设备）
    user.token_version = (user.token_version or 0) + 1
    record.used = True
    await db.commit()

    access_token = create_access_token(user.id, user.token_version)
    return {"access_token": access_token, "token_type": "bearer", "message": "密码重置成功"}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "free_searches": user.free_searches,
    }


# ── 账号自助：修改密码 / 导出数据 / 注销账号 ─────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=100)
    new_password: str = Field(min_length=8, max_length=100)


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=100)


def _check_password_attempt(user: User, password: str) -> None:
    """已登录状态下校验密码：按用户限流，防止拿到登录凭证的人暴力猜密码。"""
    key = f"user:{user.id}"
    now = time.time()
    _login_failures[key] = [t for t in _login_failures[key] if now - t < 900]
    if len(_login_failures[key]) >= 5:
        raise HTTPException(status_code=429, detail="密码错误次数过多，请 15 分钟后再试")
    if not verify_password(password, user.password_hash):
        _login_failures[key].append(now)
        raise HTTPException(status_code=400, detail="当前密码不正确")


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _check_password_attempt(user, req.current_password)
    user.password_hash = hash_password(req.new_password)
    # 其他设备上的登录随之失效；当前设备用返回的新凭证继续保持登录
    user.token_version = (user.token_version or 0) + 1
    await db.commit()
    return {
        "access_token": create_access_token(user.id, user.token_version),
        "token_type": "bearer",
        "message": "密码已修改，其他设备需要重新登录",
    }


def _loads(raw: str | None):
    try:
        return json.loads(raw) if raw else None
    except (TypeError, ValueError):
        return raw


@router.get("/export")
async def export_my_data(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """导出当前账号在服务器上保存的全部个人数据（JSON）。"""
    async def rows(model):
        return (await db.execute(select(model).where(model.user_id == user.id))).scalars().all()

    subs = await rows(Subscription)
    sub_ids = [s.id for s in subs]
    queue = (await db.execute(
        select(SubscriptionQueueItem).where(SubscriptionQueueItem.subscription_id.in_(sub_ids))
    )).scalars().all() if sub_ids else []

    iso = lambda d: d.isoformat() if d else None  # noqa: E731
    data = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "account": {"email": user.email, "created_at": iso(user.created_at),
                    "is_verified": bool(user.is_verified), "free_searches": user.free_searches},
        "saved_papers": [{"paper": _loads(r.paper_json), "saved_at": iso(r.saved_at)} for r in await rows(SavedPaper)],
        "reading_history": [{"paper": _loads(r.paper_json), "viewed_at": iso(r.viewed_at)} for r in await rows(ReadingHistory)],
        "paper_chats": [{"paper": _loads(r.paper_json), "messages": _loads(r.messages_json),
                         "pdf_text": r.pdf_text, "updated_at": iso(r.updated_at)} for r in await rows(PaperChat)],
        "search_sessions": [{"query": r.query, "keywords": _loads(r.keywords_json), "papers": _loads(r.papers_json),
                             "analysis": _loads(r.analysis_json), "created_at": iso(r.created_at)}
                            for r in await rows(SearchSession)],
        "subscriptions": [{"keywords": _loads(s.keywords_json), "active": bool(s.active), "created_at": iso(s.created_at),
                           "pushed_papers": [{"paper": _loads(q.paper_json), "planned_date": q.planned_date,
                                              "sent_at": iso(q.sent_at)}
                                             for q in queue if q.subscription_id == s.id]}
                          for s in subs],
        "feedback": [{"content": r.content, "category": r.category, "created_at": iso(r.created_at),
                      "recalled": bool(r.recalled)} for r in await rows(Feedback)],
    }
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="scholarscout-my-data.json"'})


@router.delete("/account")
async def delete_account(
    req: DeleteAccountRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """注销账号：删除账号及其收藏、阅读历史、AI 对话、搜索快照、订阅和推送记录。
    留言板上的留言保留内容但解除与账号的关联（显示为匿名），避免别人的回复失去上下文。"""
    _check_password_attempt(user, req.password)
    uid = user.id
    sub_ids = (await db.execute(select(Subscription.id).where(Subscription.user_id == uid))).scalars().all()
    if sub_ids:
        await db.execute(sa_delete(SubscriptionQueueItem).where(SubscriptionQueueItem.subscription_id.in_(sub_ids)))
    for model in (Subscription, SavedPaper, ReadingHistory, PaperChat, SearchSession, PasswordResetToken):
        await db.execute(sa_delete(model).where(model.user_id == uid))
    await db.execute(sa_update(Feedback).where(Feedback.user_id == uid).values(user_id=None, is_author=0))
    await db.execute(sa_delete(User).where(User.id == uid))
    await db.commit()
    return {"deleted": True, "message": "账号及相关数据已删除"}
