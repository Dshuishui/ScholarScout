import pytest
from datetime import datetime, timedelta
from unittest.mock import patch, AsyncMock
from tests.conftest import make_verified_user
from models_db import PasswordResetToken


# ── POST /api/auth/forgot-password ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_forgot_password_unknown_email_same_response(client):
    """防枚举：未注册邮箱也返回相同文案。"""
    r = await client.post("/api/auth/forgot-password", json={"email": "nobody@test.com"})
    assert r.status_code == 200
    assert "重置链接" in r.json()["message"]


@pytest.mark.asyncio
async def test_forgot_password_unverified_user_same_response(client):
    """未验证用户不发邮件，但返回相同文案。"""
    await client.post("/api/auth/register", json={"email": "unverified@test.com", "password": "password123"})
    r = await client.post("/api/auth/forgot-password", json={"email": "unverified@test.com"})
    assert r.status_code == 200
    assert "重置链接" in r.json()["message"]


@pytest.mark.asyncio
async def test_forgot_password_verified_user_creates_token(client, db_session):
    """已验证用户：在 DB 中创建 PasswordResetToken。"""
    await make_verified_user(db_session, email="real@test.com")
    with patch("routers.auth.send_reset_password_email", new=AsyncMock()):
        with patch("asyncio.create_task"):
            r = await client.post("/api/auth/forgot-password", json={"email": "real@test.com"})
    assert r.status_code == 200

    from sqlalchemy import select
    result = await db_session.execute(select(PasswordResetToken))
    tokens = result.scalars().all()
    assert len(tokens) == 1
    assert not tokens[0].used


# ── POST /api/auth/reset-password ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reset_password_success(client, db_session):
    """有效 token：重置密码并返回 access_token。"""
    user, _ = await make_verified_user(db_session, email="reset@test.com", password="oldpass123")

    token = "valid-reset-token-xyz"
    expires = datetime.utcnow() + timedelta(hours=1)
    record = PasswordResetToken(user_id=user.id, token=token, expires_at=expires)
    db_session.add(record)
    await db_session.commit()

    r = await client.post("/api/auth/reset-password", json={"token": token, "new_password": "newpass456"})
    assert r.status_code == 200
    assert "access_token" in r.json()

    # 新密码可以登录
    login_r = await client.post("/api/auth/login", json={"email": "reset@test.com", "password": "newpass456"})
    assert login_r.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_token_already_used(client, db_session):
    user, _ = await make_verified_user(db_session, email="used@test.com")
    token = "used-token"
    record = PasswordResetToken(
        user_id=user.id, token=token,
        expires_at=datetime.utcnow() + timedelta(hours=1),
        used=True,
    )
    db_session.add(record)
    await db_session.commit()

    r = await client.post("/api/auth/reset-password", json={"token": token, "new_password": "newpass456"})
    assert r.status_code == 400
    assert "已使用" in r.json()["detail"]


@pytest.mark.asyncio
async def test_reset_password_expired_token(client, db_session):
    user, _ = await make_verified_user(db_session, email="expired@test.com")
    token = "expired-token"
    record = PasswordResetToken(
        user_id=user.id, token=token,
        expires_at=datetime.utcnow() - timedelta(hours=2),
    )
    db_session.add(record)
    await db_session.commit()

    r = await client.post("/api/auth/reset-password", json={"token": token, "new_password": "newpass456"})
    assert r.status_code == 400
    assert "过期" in r.json()["detail"]


@pytest.mark.asyncio
async def test_reset_password_invalid_token(client):
    r = await client.post("/api/auth/reset-password", json={"token": "nonexistent", "new_password": "newpass456"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_reset_password_token_consumed_after_use(client, db_session):
    """token 使用后标记为 used，不能二次使用。"""
    user, _ = await make_verified_user(db_session, email="once@test.com")
    token = "one-time-token"
    record = PasswordResetToken(
        user_id=user.id, token=token,
        expires_at=datetime.utcnow() + timedelta(hours=1),
    )
    db_session.add(record)
    await db_session.commit()

    await client.post("/api/auth/reset-password", json={"token": token, "new_password": "pass111111"})
    r2 = await client.post("/api/auth/reset-password", json={"token": token, "new_password": "pass222222"})
    assert r2.status_code == 400
