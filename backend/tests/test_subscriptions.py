import pytest
from unittest.mock import patch, AsyncMock
from tests.conftest import make_verified_user


async def _headers(db_session, email="sub@test.com"):
    _, token = await make_verified_user(db_session, email=email)
    return {"Authorization": f"Bearer {token}"}


def _bg_noop(sub_id):
    """后台队列填充 stub，避免触发真实搜索。"""
    pass


# ── GET /api/user/subscriptions ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_subscriptions_empty(client, db_session):
    headers = await _headers(db_session)
    r = await client.get("/api/subscriptions", headers=headers)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_subscriptions_requires_auth(client):
    r = await client.get("/api/subscriptions")
    assert r.status_code == 403


# ── POST /api/subscriptions ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_subscription(client, db_session):
    headers = await _headers(db_session)
    with patch("routers.subscriptions._bg_populate_queue", new=_bg_noop):
        r = await client.post("/api/subscriptions", json={"keywords": ["RAG", "LLM"]}, headers=headers)
    assert r.status_code == 201
    data = r.json()
    assert data["keywords"] == ["RAG", "LLM"]
    assert data["active"] is True
    assert data["daily_limit"] == 1


@pytest.mark.asyncio
async def test_create_and_list_subscription(client, db_session):
    headers = await _headers(db_session)
    with patch("routers.subscriptions._bg_populate_queue", new=_bg_noop):
        await client.post("/api/subscriptions", json={"keywords": ["transformer"]}, headers=headers)
    r = await client.get("/api/subscriptions", headers=headers)
    assert len(r.json()) == 1
    assert "transformer" in r.json()[0]["keywords"]


# ── DELETE /api/subscriptions/{id} ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_subscription(client, db_session):
    headers = await _headers(db_session)
    with patch("routers.subscriptions._bg_populate_queue", new=_bg_noop):
        create_r = await client.post("/api/subscriptions", json={"keywords": ["RAG"]}, headers=headers)
    sub_id = create_r.json()["id"]

    del_r = await client.delete(f"/api/subscriptions/{sub_id}", headers=headers)
    assert del_r.status_code == 204

    list_r = await client.get("/api/subscriptions", headers=headers)
    assert list_r.json() == []


@pytest.mark.asyncio
async def test_delete_nonexistent_subscription(client, db_session):
    headers = await _headers(db_session)
    r = await client.delete("/api/subscriptions/99999", headers=headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_others_subscription_returns_404(client, db_session):
    headers_a = await _headers(db_session, email="a@test.com")
    headers_b = await _headers(db_session, email="b@test.com")
    with patch("routers.subscriptions._bg_populate_queue", new=_bg_noop):
        create_r = await client.post("/api/subscriptions", json={"keywords": ["RAG"]}, headers=headers_a)
    sub_id = create_r.json()["id"]

    r = await client.delete(f"/api/subscriptions/{sub_id}", headers=headers_b)
    assert r.status_code == 404


# ── PATCH toggle ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_toggle_subscription(client, db_session):
    headers = await _headers(db_session)
    with patch("routers.subscriptions._bg_populate_queue", new=_bg_noop):
        create_r = await client.post("/api/subscriptions", json={"keywords": ["RAG"]}, headers=headers)
    sub_id = create_r.json()["id"]

    toggle_r = await client.patch(f"/api/subscriptions/{sub_id}/toggle", headers=headers)
    assert toggle_r.status_code == 200
    assert toggle_r.json()["active"] is False

    toggle_r2 = await client.patch(f"/api/subscriptions/{sub_id}/toggle", headers=headers)
    assert toggle_r2.json()["active"] is True


# ── PATCH daily-limit ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_daily_limit(client, db_session):
    headers = await _headers(db_session)
    with patch("routers.subscriptions._bg_populate_queue", new=_bg_noop):
        create_r = await client.post("/api/subscriptions", json={"keywords": ["RAG"]}, headers=headers)
    sub_id = create_r.json()["id"]

    r = await client.patch(
        f"/api/subscriptions/{sub_id}/daily-limit",
        json={"daily_limit": 5},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["daily_limit"] == 5


@pytest.mark.asyncio
async def test_update_daily_limit_out_of_range(client, db_session):
    headers = await _headers(db_session)
    with patch("routers.subscriptions._bg_populate_queue", new=_bg_noop):
        create_r = await client.post("/api/subscriptions", json={"keywords": ["RAG"]}, headers=headers)
    sub_id = create_r.json()["id"]

    r = await client.patch(
        f"/api/subscriptions/{sub_id}/daily-limit",
        json={"daily_limit": 0},
        headers=headers,
    )
    assert r.status_code == 422
