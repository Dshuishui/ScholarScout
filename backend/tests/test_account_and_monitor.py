"""第三批：账号自助（修改密码 / 导出 / 注销）与数据源健康监控。"""
import json
import time
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select, func

from tests.conftest import make_verified_user


# ── 修改密码 ──────────────────────────────────────────────────────────────────

async def test_change_password_rotates_tokens(client, db_session):
    _, token = await make_verified_user(db_session, email="cp@test.com", password="old-password-1")
    old = {"Authorization": f"Bearer {token}"}
    r = await client.post("/api/auth/change-password",
                          json={"current_password": "old-password-1", "new_password": "new-password-2"}, headers=old)
    assert r.status_code == 200
    new = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert (await client.get("/api/auth/me", headers=old)).status_code == 401
    assert (await client.get("/api/auth/me", headers=new)).status_code == 200
    login = await client.post("/api/auth/login", json={"email": "cp@test.com", "password": "new-password-2"})
    assert login.status_code == 200


async def test_change_password_wrong_current_is_rate_limited(client, db_session):
    _, token = await make_verified_user(db_session, email="cp2@test.com", password="right-password")
    h = {"Authorization": f"Bearer {token}"}
    codes = [(await client.post("/api/auth/change-password",
                                json={"current_password": "wrong", "new_password": "whatever-123"}, headers=h)).status_code
             for _ in range(6)]
    assert codes == [400] * 5 + [429]


# ── 导出与注销 ────────────────────────────────────────────────────────────────

async def _seed_user_data(client, h):
    await client.post("/api/user/saved", json={"paper": {"paper_id": "p1", "title": "Saved"}}, headers=h)
    await client.post("/api/user/history", json={"paper": {"title": "Viewed"}}, headers=h)
    await client.post("/api/user/chats", json={"paper": {"paper_id": "p1", "title": "Chat"},
                                               "messages": [{"role": "user", "content": "hi"}]}, headers=h)
    await client.post("/api/user/sessions", json={"query": "q", "keywords": ["k"], "papers": []}, headers=h)
    with patch("routers.subscriptions._bg_populate_queue", new=lambda sub_id: None):
        await client.post("/api/subscriptions", json={"keywords": ["raft"]}, headers=h)
    with patch("routers.feedback._get_location", new=AsyncMock(return_value=None)):
        await client.post("/api/feedback", json={"content": "我的留言"}, headers=h)


async def test_export_contains_all_personal_data(client, db_session):
    _, token = await make_verified_user(db_session, email="exp@test.com")
    h = {"Authorization": f"Bearer {token}"}
    await _seed_user_data(client, h)
    r = await client.get("/api/auth/export", headers=h)
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["account"]["email"] == "exp@test.com"
    assert "password" not in json.dumps(data["account"])
    for key in ("saved_papers", "reading_history", "paper_chats", "search_sessions", "subscriptions", "feedback"):
        assert len(data[key]) == 1, key


async def test_delete_account_removes_data_and_anonymizes_feedback(client, db_session):
    from models_db import User, SavedPaper, ReadingHistory, PaperChat, SearchSession, Subscription, Feedback
    _, token = await make_verified_user(db_session, email="del@test.com", password="del-password-1")
    h = {"Authorization": f"Bearer {token}"}
    await _seed_user_data(client, h)

    assert (await client.request("DELETE", "/api/auth/account", json={"password": "wrong"}, headers=h)).status_code == 400
    r = await client.request("DELETE", "/api/auth/account", json={"password": "del-password-1"}, headers=h)
    assert r.status_code == 200

    for model in (User, SavedPaper, ReadingHistory, PaperChat, SearchSession, Subscription):
        assert (await db_session.execute(select(func.count()).select_from(model))).scalar_one() == 0, model.__name__
    fb = (await db_session.execute(select(Feedback))).scalars().all()
    assert len(fb) == 1 and fb[0].user_id is None and fb[0].content == "我的留言"
    assert (await client.get("/api/auth/me", headers=h)).status_code == 401


# ── 数据源健康监控 ────────────────────────────────────────────────────────────

@pytest.fixture
def monitor():
    from services import health_monitor as hm
    hm._calls.clear()
    hm._last_alert.clear()
    yield hm
    hm._calls.clear()
    hm._last_alert.clear()


def test_alerts_when_healthy_source_starts_returning_nothing(monitor):
    now = time.time()
    for i in range(6):
        monitor._calls["OpenAlex"].append((now - monitor.WINDOW_SEC - 100 - i, 30))  # 上个窗口正常
        monitor._calls["OpenAlex"].append((now - 100 - i, 0))                         # 这个窗口全 0
        monitor._calls["CrossRef"].append((now - 100 - i, 20))
    keys = [k for k, _ in monitor.detect_problems(now)]
    assert keys == ["source:OpenAlex"]


def test_no_alert_for_source_that_was_never_healthy(monitor):
    # arXiv 一直被限流、没配 key 的源一直返回 0：不应该每天发邮件
    now = time.time()
    for i in range(20):
        monitor._calls["arXiv"].append((now - i * 60, 0))
        monitor._calls["CrossRef"].append((now - i * 60, 10))
    assert monitor.detect_problems(now) == []


def test_alerts_when_all_sources_return_nothing(monitor):
    now = time.time()
    for src in ("OpenAlex", "CrossRef", "PubMed"):
        for i in range(5):
            monitor._calls[src].append((now - i * 60, 0))
    assert "all-sources" in [k for k, _ in monitor.detect_problems(now)]


async def test_alert_email_sent_at_most_once_per_day(monitor, monkeypatch):
    now = time.time()
    for src in ("OpenAlex", "CrossRef"):
        for i in range(5):
            monitor._calls[src].append((now - i * 60, 0))
    sent = AsyncMock(return_value=True)
    monkeypatch.setattr("services.email_service.send_admin_alert", sent)
    monkeypatch.setattr(monitor, "stalled_subscriptions", AsyncMock(return_value=[]))
    monkeypatch.setattr(monitor, "trial_usage_last_day", AsyncMock(return_value=0))
    await monitor.run_health_check()
    await monitor.run_health_check()
    assert sent.await_count == 1


async def test_stalled_subscription_detection(db_session):
    from datetime import datetime, timedelta
    from models_db import Subscription
    from services.health_monitor import stalled_subscriptions
    old = datetime.utcnow() - timedelta(days=10)
    db_session.add_all([
        Subscription(user_id=1, keywords_json='["a"]', active=True, created_at=old, last_sent=old),              # 停推
        Subscription(user_id=1, keywords_json='["b"]', active=True, created_at=old, last_sent=datetime.utcnow()),  # 正常
        Subscription(user_id=1, keywords_json='["c"]', active=False, created_at=old, last_sent=old),              # 已停用
        Subscription(user_id=1, keywords_json='["d"]', active=True, created_at=datetime.utcnow()),               # 刚创建
    ])
    await db_session.commit()
    assert len(await stalled_subscriptions(db_session)) == 1


async def test_search_records_source_results(monitor):
    from models import ParsedQuery
    from services.search_service import search_all_sources
    with patch.dict("services.search_service._SOURCE_FUNCS",
                    {"OpenAlex": AsyncMock(return_value=[]), "CrossRef": AsyncMock(return_value=[])}, clear=True):
        await search_all_sources(ParsedQuery(keywords=["x"]))
    assert set(monitor._calls) == {"OpenAlex", "CrossRef"}


async def test_health_endpoint_reports_source_activity(client, monitor):
    monitor.record_source_result("OpenAlex", 12)
    data = (await client.get("/api/health")).json()
    assert data["source_activity"]["OpenAlex"]["nonzero_6h"] == 1


async def test_alerts_when_anonymous_trial_nears_daily_cap(monitor, monkeypatch):
    sent = AsyncMock(return_value=True)
    monkeypatch.setattr("services.email_service.send_admin_alert", sent)
    monkeypatch.setattr(monitor, "stalled_subscriptions", AsyncMock(return_value=[]))
    monkeypatch.setattr(monitor.config, "ANON_TRIAL_DAILY_CAP", 100)
    monkeypatch.setattr(monitor, "trial_usage_last_day", AsyncMock(return_value=79))
    assert await monitor.run_health_check() == []
    monkeypatch.setattr(monitor, "trial_usage_last_day", AsyncMock(return_value=80))
    alerts = await monitor.run_health_check()
    assert len(alerts) == 1 and "80/100" in alerts[0]
