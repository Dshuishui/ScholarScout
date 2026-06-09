import secrets
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_db
from models_db import User, PasswordResetToken
from services.auth_service import hash_password, verify_password, create_access_token
from services.email_service import send_verification_email, send_reset_password_email
from dependencies import get_current_user
from config import FREE_SEARCHES_QUOTA, APP_BASE_URL, DEEPSEEK_SYSTEM_KEY

router = APIRouter()

# ── 内存限流（小规模部署足够，生产级应用换 Redis）──────────────────────────────
# 格式：{ key: [timestamp, ...] }
_register_attempts: dict[str, list[float]] = defaultdict(list)  # IP → 注册时间戳
_login_failures: dict[str, list[float]] = defaultdict(list)     # IP → 登录失败时间戳
_resend_attempts: dict[str, list[float]] = defaultdict(list)    # email → 重发时间戳
_reset_attempts: dict[str, list[float]] = defaultdict(list)     # IP → 重置密码请求时间戳

def _rate_ok(store: dict, key: str, limit: int, window_sec: int) -> bool:
    """检查是否在限额内。是则记录并返回 True；否则返回 False。"""
    now = time.time()
    store[key] = [t for t in store[key] if now - t < window_sec]
    if len(store[key]) >= limit:
        return False
    store[key].append(now)
    return True

def _get_ip(request: Request) -> str:
    """尽量取真实 IP（Nginx 代理后取 X-Forwarded-For）。"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


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
        # 已注册但未验证：重新发一封验证邮件
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

    access_token = create_access_token(user.id)
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
        "access_token": create_access_token(user.id),
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
    record.used = True
    await db.commit()

    access_token = create_access_token(user.id)
    return {"access_token": access_token, "token_type": "bearer", "message": "密码重置成功"}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {
        "id": user.id,
        "email": user.email,
        "free_searches": user.free_searches,
    }
