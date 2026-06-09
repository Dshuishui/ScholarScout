import pytest
from unittest.mock import patch, AsyncMock
from tests.conftest import make_verified_user


async def _headers(db_session, email="user@test.com"):
    _, token = await make_verified_user(db_session, email=email)
    return {"Authorization": f"Bearer {token}"}


# ── GET /api/feedback ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_feedback_empty(client):
    r = await client.get("/api/feedback")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_get_feedback_anonymous_ok(client):
    """未登录也可以读留言板。"""
    r = await client.get("/api/feedback")
    assert r.status_code == 200


# ── POST /api/feedback ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_post_feedback_anonymous(client):
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        r = await client.post("/api/feedback", json={"content": "匿名留言"})
    assert r.status_code == 201
    assert r.json()["ok"] is True
    assert "id" in r.json()


@pytest.mark.asyncio
async def test_post_feedback_authenticated_shows_sender_name(client, db_session):
    headers = await _headers(db_session, email="alice@example.com")
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        await client.post("/api/feedback", json={"content": "登录留言"}, headers=headers)

    r = await client.get("/api/feedback", headers=headers)
    msgs = r.json()
    assert len(msgs) == 1
    assert msgs[0]["sender_name"] == "alice"
    assert msgs[0]["is_mine"] is True


@pytest.mark.asyncio
async def test_post_feedback_empty_content_rejected(client):
    r = await client.post("/api/feedback", json={"content": ""})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_post_feedback_too_long_rejected(client):
    r = await client.post("/api/feedback", json={"content": "x" * 201})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_post_feedback_with_category(client):
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        r = await client.post("/api/feedback", json={"content": "建议内容", "category": "suggest"})
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_post_feedback_invalid_category_defaults_to_chat(client):
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        await client.post("/api/feedback", json={"content": "留言", "category": "invalid"})
    r = await client.get("/api/feedback")
    assert r.json()[0]["category"] == "chat"


# ── DELETE /api/feedback/{id}（撤回） ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_recall_own_message(client, db_session):
    headers = await _headers(db_session)
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        post_r = await client.post("/api/feedback", json={"content": "可以撤回"}, headers=headers)
    msg_id = post_r.json()["id"]

    r = await client.delete(f"/api/feedback/{msg_id}", headers=headers)
    assert r.status_code == 200
    assert r.json()["recalled"] is True


@pytest.mark.asyncio
async def test_recall_requires_auth(client, db_session):
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        post_r = await client.post("/api/feedback", json={"content": "留言"})
    msg_id = post_r.json()["id"]
    r = await client.delete(f"/api/feedback/{msg_id}")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_recall_others_message_forbidden(client, db_session):
    headers_a = await _headers(db_session, email="a@test.com")
    headers_b = await _headers(db_session, email="b@test.com")
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        post_r = await client.post("/api/feedback", json={"content": "A的留言"}, headers=headers_a)
    msg_id = post_r.json()["id"]

    r = await client.delete(f"/api/feedback/{msg_id}", headers=headers_b)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_recall_nonexistent_returns_404(client, db_session):
    headers = await _headers(db_session)
    r = await client.delete("/api/feedback/99999", headers=headers)
    assert r.status_code == 404


# ── PATCH /api/feedback/{id}/react ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_react_add_emoji(client):
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        post_r = await client.post("/api/feedback", json={"content": "可以反应"})
    msg_id = post_r.json()["id"]

    r = await client.patch(f"/api/feedback/{msg_id}/react", json={"emoji": "👍", "action": "add"})
    assert r.status_code == 200
    assert r.json()["reactions"]["👍"] == 1


@pytest.mark.asyncio
async def test_react_remove_emoji(client):
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        post_r = await client.post("/api/feedback", json={"content": "测试"})
    msg_id = post_r.json()["id"]

    await client.patch(f"/api/feedback/{msg_id}/react", json={"emoji": "👍", "action": "add"})
    r = await client.patch(f"/api/feedback/{msg_id}/react", json={"emoji": "👍", "action": "remove"})
    assert r.status_code == 200
    assert r.json()["reactions"]["👍"] == 0


@pytest.mark.asyncio
async def test_react_invalid_emoji_rejected(client):
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        post_r = await client.post("/api/feedback", json={"content": "测试"})
    msg_id = post_r.json()["id"]

    r = await client.patch(f"/api/feedback/{msg_id}/react", json={"emoji": "😈", "action": "add"})
    assert r.status_code == 400
