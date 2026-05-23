import pytest
from tests.conftest import make_verified_user

PAPER = {
    "paper_id": "abc123",
    "title": "Test Paper",
    "authors": ["Alice"],
    "source": "arXiv",
    "citations": 0,
    "doi": "10.1234/test",
}

PAPER2 = {
    "paper_id": "xyz999",
    "title": "Another Paper",
    "authors": ["Bob"],
    "source": "PubMed",
    "citations": 5,
    "doi": "10.5678/other",
}


async def get_auth_headers(db_session) -> dict:
    """直接在 DB 中创建已验证用户，绕过邮件验证流程。"""
    _, token = await make_verified_user(db_session, email="u@test.com")
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_save_and_list_paper(client, db_session):
    headers = await get_auth_headers(db_session)
    r = await client.post("/api/user/saved", json={"paper": PAPER}, headers=headers)
    assert r.status_code == 201
    r2 = await client.get("/api/user/saved", headers=headers)
    assert r2.status_code == 200
    assert len(r2.json()) == 1
    assert r2.json()[0]["paper"]["title"] == "Test Paper"
    assert "paper_id_hash" in r2.json()[0]


@pytest.mark.asyncio
async def test_save_duplicate_returns_409(client, db_session):
    headers = await get_auth_headers(db_session)
    await client.post("/api/user/saved", json={"paper": PAPER}, headers=headers)
    r = await client.post("/api/user/saved", json={"paper": PAPER}, headers=headers)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_unsave_paper(client, db_session):
    headers = await get_auth_headers(db_session)
    await client.post("/api/user/saved", json={"paper": PAPER}, headers=headers)
    saved = await client.get("/api/user/saved", headers=headers)
    paper_hash = saved.json()[0]["paper_id_hash"]
    r = await client.delete(f"/api/user/saved/{paper_hash}", headers=headers)
    assert r.status_code == 200
    r2 = await client.get("/api/user/saved", headers=headers)
    assert len(r2.json()) == 0


@pytest.mark.asyncio
async def test_unsave_nonexistent_returns_404(client, db_session):
    headers = await get_auth_headers(db_session)
    r = await client.delete("/api/user/saved/nonexistent", headers=headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_and_get_history(client, db_session):
    headers = await get_auth_headers(db_session)
    r = await client.post("/api/user/history", json={"paper": PAPER}, headers=headers)
    assert r.status_code == 201
    r2 = await client.get("/api/user/history", headers=headers)
    assert r2.status_code == 200
    assert len(r2.json()) == 1


@pytest.mark.asyncio
async def test_saved_requires_auth(client):
    r = await client.get("/api/user/saved")
    assert r.status_code == 403
