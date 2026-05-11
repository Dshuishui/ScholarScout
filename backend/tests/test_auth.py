import pytest


@pytest.mark.asyncio
async def test_register_success(client):
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 200
    assert "access_token" in r.json()


@pytest.mark.asyncio
async def test_register_duplicate_email(client):
    await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_register_short_password(client):
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "short"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_login_success(client):
    await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    r = await client.post("/api/auth/login", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 200
    assert "access_token" in r.json()


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    r = await client.post("/api/auth/login", json={"email": "a@b.com", "password": "wrongpass"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_success(client):
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    token = r.json()["access_token"]
    r2 = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["email"] == "a@b.com"


@pytest.mark.asyncio
async def test_me_no_token(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 403
