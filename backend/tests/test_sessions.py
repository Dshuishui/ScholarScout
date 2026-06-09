import pytest
from tests.conftest import make_verified_user

PAPER = {
    "paper_id": "arxiv-001",
    "title": "Attention Is All You Need",
    "authors": ["Vaswani"],
    "source": "arXiv",
    "citations": 100,
}

SESSION_BODY = {
    "keywords": ["transformer", "attention"],
    "papers": [PAPER],
    "analysis": {},
}


async def _headers(db_session, email="s@test.com"):
    _, token = await make_verified_user(db_session, email=email)
    return {"Authorization": f"Bearer {token}"}


# ── GET /api/user/sessions ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_sessions_empty(client, db_session):
    headers = await _headers(db_session)
    r = await client.get("/api/user/sessions", headers=headers)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_sessions_requires_auth(client):
    r = await client.get("/api/user/sessions")
    assert r.status_code == 403


# ── POST /api/user/sessions ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_session(client, db_session):
    headers = await _headers(db_session)
    r = await client.post("/api/user/sessions", json=SESSION_BODY, headers=headers)
    assert r.status_code == 201
    assert "id" in r.json()


@pytest.mark.asyncio
async def test_create_and_list_session(client, db_session):
    headers = await _headers(db_session)
    await client.post("/api/user/sessions", json=SESSION_BODY, headers=headers)
    r = await client.get("/api/user/sessions", headers=headers)
    assert len(r.json()) == 1
    assert r.json()[0]["keywords"] == ["transformer", "attention"]
    assert len(r.json()[0]["papers"]) == 1


@pytest.mark.asyncio
async def test_create_multiple_sessions(client, db_session):
    headers = await _headers(db_session)
    await client.post("/api/user/sessions", json=SESSION_BODY, headers=headers)
    body2 = {**SESSION_BODY, "keywords": ["RAG", "retrieval"]}
    await client.post("/api/user/sessions", json=body2, headers=headers)
    r = await client.get("/api/user/sessions", headers=headers)
    assert len(r.json()) == 2


# ── PATCH /api/user/sessions/{id}/analysis ────────────────────────────────────

@pytest.mark.asyncio
async def test_update_session_analysis(client, db_session):
    headers = await _headers(db_session)
    create_r = await client.post("/api/user/sessions", json=SESSION_BODY, headers=headers)
    session_id = create_r.json()["id"]

    patch_r = await client.patch(
        f"/api/user/sessions/{session_id}/analysis",
        json={"mode": "compare", "content": "对比分析文本"},
        headers=headers,
    )
    assert patch_r.status_code == 200

    list_r = await client.get("/api/user/sessions", headers=headers)
    assert list_r.json()[0]["analysis"]["compare"] == "对比分析文本"


@pytest.mark.asyncio
async def test_update_analysis_wrong_owner_returns_404(client, db_session):
    headers_a = await _headers(db_session, email="a@test.com")
    headers_b = await _headers(db_session, email="b@test.com")
    create_r = await client.post("/api/user/sessions", json=SESSION_BODY, headers=headers_a)
    session_id = create_r.json()["id"]

    r = await client.patch(
        f"/api/user/sessions/{session_id}/analysis",
        json={"mode": "compare", "content": "入侵"},
        headers=headers_b,
    )
    assert r.status_code == 404


# ── DELETE /api/user/sessions/{id} ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_session(client, db_session):
    headers = await _headers(db_session)
    create_r = await client.post("/api/user/sessions", json=SESSION_BODY, headers=headers)
    session_id = create_r.json()["id"]

    del_r = await client.delete(f"/api/user/sessions/{session_id}", headers=headers)
    assert del_r.status_code == 200

    list_r = await client.get("/api/user/sessions", headers=headers)
    assert list_r.json() == []


@pytest.mark.asyncio
async def test_delete_nonexistent_session(client, db_session):
    headers = await _headers(db_session)
    r = await client.delete("/api/user/sessions/99999", headers=headers)
    assert r.status_code == 404
