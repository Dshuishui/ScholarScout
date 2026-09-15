"""第一批加固的回归测试：限流 IP、PDF 上传、parse 限流、邮件转义、CORS、点赞、阅读历史、日志。"""
import logging
from unittest.mock import AsyncMock, patch

import pytest

from tests.conftest import make_verified_user


# ── 限流不能靠伪造 X-Forwarded-For 绕过 ───────────────────────────────────────

async def test_login_rate_limit_ignores_spoofed_forwarded_for(client, db_session):
    await make_verified_user(db_session, email="victim@test.com")
    for i in range(10):
        r = await client.post(
            "/api/auth/login",
            json={"email": "victim@test.com", "password": "wrong-password"},
            headers={"X-Forwarded-For": f"203.0.113.{i}"},  # 每次换一个伪造 IP
        )
        assert r.status_code == 401
    r = await client.post(
        "/api/auth/login",
        json={"email": "victim@test.com", "password": "wrong-password"},
        headers={"X-Forwarded-For": "198.51.100.99"},
    )
    assert r.status_code == 429


def test_client_ip_prefers_real_ip_header():
    from starlette.requests import Request
    from services.rate_limit import client_ip
    scope = {"type": "http", "headers": [(b"x-forwarded-for", b"1.2.3.4"), (b"x-real-ip", b"8.8.8.8")],
             "client": ("127.0.0.1", 5000)}
    assert client_ip(Request(scope)) == "8.8.8.8"
    scope["headers"] = [(b"x-forwarded-for", b"1.2.3.4")]
    assert client_ip(Request(scope)) == "127.0.0.1"  # 没有 X-Real-IP 时不信 XFF


async def test_register_resend_is_limited_per_email(client):
    # 未验证邮箱反复注册会重发验证邮件：按收件地址限流，换 IP 也没用
    with patch("routers.auth.send_verification_email", new=AsyncMock(return_value=True)) as send:
        await client.post("/api/auth/register", json={"email": "target@test.com", "password": "password123"})
        codes = []
        for i in range(5):
            r = await client.post("/api/auth/register",
                                  json={"email": "target@test.com", "password": "password123"},
                                  headers={"X-Real-IP": f"203.0.113.{i}"})
            codes.append(r.status_code)
    assert codes[:3] == [200, 200, 200]
    assert codes[3:] == [429, 429]
    assert send.await_count == 4  # 首次注册 1 封 + 重发 3 封


# ── PDF 上传 ──────────────────────────────────────────────────────────────────

async def test_fetch_pdf_endpoint_removed(client):
    r = await client.post("/api/paper/fetch-pdf", json={"pdf_url": "http://127.0.0.1:3001/"})
    assert r.status_code in (404, 405)


async def test_parse_pdf_rejects_oversized_upload(client, monkeypatch):
    import routers.paper as paper_router
    monkeypatch.setattr(paper_router, "MAX_UPLOAD_BYTES", 10)
    r = await client.post("/api/paper/parse-pdf", files={"file": ("a.pdf", b"x" * 11, "application/pdf")})
    assert r.json() == {"error": "too_large"}


# ── 试用用户 parse 限流 ───────────────────────────────────────────────────────

async def test_trial_parse_is_rate_limited(client, db_session, monkeypatch):
    import routers.search as search_router
    user, token = await make_verified_user(db_session, email="trial@test.com")
    user.free_searches = 3
    await db_session.commit()
    monkeypatch.setattr(search_router, "DEEPSEEK_SYSTEM_KEY", "sk-system")
    monkeypatch.setattr(search_router, "TRIAL_PARSE_PER_HOUR", 2)
    monkeypatch.setattr(search_router, "classify_intent",
                        AsyncMock(return_value={"intent": "chat", "reply": "hi"}))
    headers = {"Authorization": f"Bearer {token}"}
    codes = [(await client.post("/api/parse", json={"query": "hello"}, headers=headers)).status_code
             for _ in range(3)]
    assert codes == [200, 200, 429]


# ── 邮件 HTML 转义 ────────────────────────────────────────────────────────────

async def test_reply_notification_escapes_user_html(monkeypatch):
    from services import email_service
    monkeypatch.setattr(email_service, "SMTP_USER", "u@qq.com")
    monkeypatch.setattr(email_service, "SMTP_PASS", "pw")
    with patch.object(email_service.aiosmtplib, "send", new=AsyncMock()) as send:
        await email_service.send_reply_notification(
            "victim@test.com", "原留言", '<a href="https://phish.example">点这里领奖</a>')
    body = send.call_args.args[0].get_payload()[0].get_payload(decode=True).decode("utf-8")
    assert '<a href="https://phish.example">' not in body
    assert "&lt;a href=" in body


def test_paper_card_drops_non_http_links_and_escapes_title():
    from models import Paper
    from services.email_service import _paper_card_html
    html = _paper_card_html(Paper(paper_id="1", title="<script>x</script>", authors=[],
                                  source="arXiv", url="javascript:alert(1)"))
    assert "javascript:" not in html and "<script>" not in html


# ── CORS ──────────────────────────────────────────────────────────────────────

async def test_cors_rejects_unknown_origin(client):
    r = await client.options("/api/health", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") != "*"
    assert r.headers.get("access-control-allow-origin") != "https://evil.example"


# ── 留言点赞 ──────────────────────────────────────────────────────────────────

async def _post_msg(client):
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        return (await client.post("/api/feedback", json={"content": "测试"})).json()["id"]


async def test_same_ip_cannot_inflate_reactions(client):
    msg_id = await _post_msg(client)
    for _ in range(5):
        r = await client.patch(f"/api/feedback/{msg_id}/react", json={"emoji": "👍", "action": "add"})
    assert r.json()["reactions"]["👍"] == 1


async def test_cannot_remove_other_ips_reaction(client):
    msg_id = await _post_msg(client)
    await client.patch(f"/api/feedback/{msg_id}/react", json={"emoji": "👍", "action": "add"},
                       headers={"X-Real-IP": "203.0.113.1"})
    r = await client.patch(f"/api/feedback/{msg_id}/react", json={"emoji": "👍", "action": "remove"},
                           headers={"X-Real-IP": "203.0.113.2"})
    assert r.json()["reactions"]["👍"] == 1


# ── 阅读历史上限 ──────────────────────────────────────────────────────────────

async def test_history_is_capped(client, db_session, monkeypatch):
    import routers.user as user_router
    monkeypatch.setattr(user_router, "MAX_HISTORY", 3)
    _, token = await make_verified_user(db_session, email="h@test.com")
    headers = {"Authorization": f"Bearer {token}"}
    for i in range(5):
        await client.post("/api/user/history", json={"paper": {"title": f"P{i}"}}, headers=headers)
    from sqlalchemy import select, func
    from models_db import ReadingHistory
    count = (await db_session.execute(select(func.count(ReadingHistory.id)))).scalar_one()
    assert count == 3
    titles = [p["title"] for p in (await client.get("/api/user/history", headers=headers)).json()]
    assert set(titles) == {"P2", "P3", "P4"}  # 保留最新的


# ── 应用启动跑数据库迁移后，业务日志不能被禁用 ────────────────────────────────

def test_migrations_keep_application_loggers_enabled(tmp_path, monkeypatch):
    import database
    from logging_config import setup_logging

    setup_logging()
    scheduler_logger = logging.getLogger("scheduler")
    root_level = logging.getLogger().level

    db_url = f"sqlite+aiosqlite:///{tmp_path / 'migrate.db'}"
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setattr(database, "DATABASE_URL", db_url)
    database._run_alembic()

    assert scheduler_logger.disabled is False
    assert logging.getLogger().level == root_level
