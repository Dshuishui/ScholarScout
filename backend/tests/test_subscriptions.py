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
    assert r.status_code == 401


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


# ── 邮件一键退订 ──────────────────────────────────────────────────────────────

async def _create_sub(client, headers, keywords=("RAG",)):
    with patch("routers.subscriptions._bg_populate_queue", new=_bg_noop):
        r = await client.post("/api/subscriptions", json={"keywords": list(keywords)}, headers=headers)
    return r.json()["id"]


async def _is_active(client, headers, sub_id):
    subs = (await client.get("/api/subscriptions", headers=headers)).json()
    return next(s for s in subs if s["id"] == sub_id)["active"]


@pytest.mark.asyncio
async def test_unsubscribe_get_shows_confirm_without_deactivating(client, db_session):
    # 企业邮箱安全网关会预先访问链接，GET 绝不能改状态
    from services.auth_service import create_unsubscribe_token
    headers = await _headers(db_session)
    sub_id = await _create_sub(client, headers)

    r = await client.get(f"/api/subscriptions/unsubscribe?token={create_unsubscribe_token(sub_id)}")
    assert r.status_code == 200
    assert "确认退订" in r.text
    assert await _is_active(client, headers, sub_id) is True


@pytest.mark.asyncio
async def test_unsubscribe_post_deactivates(client, db_session):
    from services.auth_service import create_unsubscribe_token
    headers = await _headers(db_session)
    sub_id = await _create_sub(client, headers)

    r = await client.post(
        f"/api/subscriptions/unsubscribe?token={create_unsubscribe_token(sub_id)}",
        content="List-Unsubscribe=One-Click",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 200
    assert "已退订" in r.text
    assert await _is_active(client, headers, sub_id) is False


@pytest.mark.asyncio
async def test_unsubscribe_invalid_token(client, db_session):
    r = await client.post("/api/subscriptions/unsubscribe?token=not-a-token")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_login_token_cannot_unsubscribe(client, db_session):
    _, login_token = await make_verified_user(db_session, email="x@test.com")
    r = await client.post(f"/api/subscriptions/unsubscribe?token={login_token}")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_unsubscribe_token_cannot_log_in(client, db_session):
    from services.auth_service import create_unsubscribe_token
    r = await client.get(
        "/api/subscriptions",
        headers={"Authorization": f"Bearer {create_unsubscribe_token(1)}"},
    )
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_unsubscribe_page_escapes_keywords(client, db_session):
    from services.auth_service import create_unsubscribe_token
    headers = await _headers(db_session)
    sub_id = await _create_sub(client, headers, keywords=["<script>alert(1)</script>"])

    r = await client.get(f"/api/subscriptions/unsubscribe?token={create_unsubscribe_token(sub_id)}")
    assert "<script>alert(1)</script>" not in r.text


@pytest.mark.asyncio
async def test_subscription_email_has_unsubscribe_link_and_headers():
    from models import Paper
    from services import email_service

    url = "http://example.com/api/subscriptions/unsubscribe?token=abc"
    paper = Paper(paper_id="p1", title="T", authors=["A"], source="arXiv")
    with patch.object(email_service, "SMTP_USER", "u@qq.com"), \
         patch.object(email_service, "SMTP_PASS", "pw"), \
         patch.object(email_service.aiosmtplib, "send", new=AsyncMock()) as send:
        ok = await email_service.send_subscription_email("to@test.com", ["RAG"], [paper], url)

    assert ok is True
    msg = send.call_args.args[0]
    assert msg["List-Unsubscribe"] == f"<{url}>"
    assert msg["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert url in msg.get_payload()[0].get_payload(decode=True).decode("utf-8")


def test_daily_job_runs_at_utc_midnight():
    from scheduler import setup_scheduler
    job = setup_scheduler().get_job("daily_subscriptions")
    assert str(job.trigger.timezone) == "UTC"
