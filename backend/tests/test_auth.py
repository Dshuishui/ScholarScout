import pytest
from tests.conftest import make_verified_user


# ── Register ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_register_success(client):
    """注册新用户：发验证邮件，返回 message 而非 token。"""
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 200
    data = r.json()
    assert "message" in data
    assert "access_token" not in data


@pytest.mark.asyncio
async def test_register_duplicate_verified_email(client, db_session):
    """已验证邮箱再注册：返回 400。"""
    await make_verified_user(db_session, email="a@b.com")
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_register_duplicate_unverified_email(client):
    """未验证邮箱再注册：重发验证邮件，返回 200 + message。"""
    await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 200
    assert "message" in r.json()


@pytest.mark.asyncio
async def test_register_short_password(client):
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "short"})
    assert r.status_code == 422


# ── Login ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_success(client, db_session):
    """已验证用户登录成功，返回 access_token。"""
    await make_verified_user(db_session, email="a@b.com", password="password123")
    r = await client.post("/api/auth/login", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 200
    assert "access_token" in r.json()


@pytest.mark.asyncio
async def test_login_wrong_password(client, db_session):
    await make_verified_user(db_session, email="a@b.com", password="password123")
    r = await client.post("/api/auth/login", json={"email": "a@b.com", "password": "wrongpass"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_login_unverified_returns_403(client):
    """未验证邮箱登录：返回 403。"""
    await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    r = await client.post("/api/auth/login", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 403


# ── /me ───────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_me_success(client, db_session):
    _, token = await make_verified_user(db_session, email="a@b.com")
    r = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["email"] == "a@b.com"


@pytest.mark.asyncio
async def test_me_no_token(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 403
