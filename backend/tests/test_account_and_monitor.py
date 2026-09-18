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

def _isolate_environment_checks(monitor, monkeypatch, keep_trial: bool = False):
    """run_health_check 会查磁盘、错误数、数据库计数——测告警逻辑时把这些环境相关的检查关掉。"""
    if not keep_trial:
        monkeypatch.setattr(monitor, "trial_usage_last_day", AsyncMock(return_value=0))
    monkeypatch.setattr(monitor, "deepseek_balance", AsyncMock(return_value=None))
    monkeypatch.setattr(monitor, "disk_problem", lambda: None)
    monkeypatch.setattr(monitor, "error_spike_problem", lambda now: None)
    monkeypatch.setattr(monitor, "push_failure_problem", AsyncMock(return_value=None))
    monkeypatch.setattr(monitor, "first_real_user", AsyncMock(return_value=None))


@pytest.fixture
def monitor(tmp_path, monkeypatch):
    from services import health_monitor as hm
    hm._calls.clear()
    hm._last_alert.clear()
    monkeypatch.setattr(hm, "ALERT_STATE_FILE", tmp_path / "alert_state.json")
    monkeypatch.setattr(hm, "_state_loaded", False)
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
    _isolate_environment_checks(monitor, monkeypatch)
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
    _isolate_environment_checks(monitor, monkeypatch, keep_trial=True)
    monkeypatch.setattr(monitor, "trial_usage_last_day", AsyncMock(return_value=79))
    assert await monitor.run_health_check() == []
    monkeypatch.setattr(monitor, "trial_usage_last_day", AsyncMock(return_value=80))
    alerts = await monitor.run_health_check()
    assert len(alerts) == 1 and "80/100" in alerts[0]


# ── 备份新鲜度告警 ────────────────────────────────────────────────────────────

def test_backup_check_skipped_when_not_configured(monitor, monkeypatch):
    monkeypatch.setattr(monitor.config, "BACKUP_STATUS_FILE", "")
    assert monitor.backup_problem(time.time()) is None


def test_backup_alert_when_status_file_missing(monitor, monkeypatch, tmp_path):
    monkeypatch.setattr(monitor.config, "BACKUP_STATUS_FILE", str(tmp_path / "nope"))
    key, msg = monitor.backup_problem(time.time())
    assert key == "backup" and "从未成功" in msg


def test_backup_alert_only_when_stale(monitor, monkeypatch, tmp_path):
    status = tmp_path / "last_success"
    now = time.time()
    monkeypatch.setattr(monitor.config, "BACKUP_STATUS_FILE", str(status))
    monkeypatch.setattr(monitor.config, "BACKUP_MAX_AGE_HOURS", 36)
    status.write_text(str(now - 30 * 3600))
    assert monitor.backup_problem(now) is None
    status.write_text(str(now - 40 * 3600))
    key, msg = monitor.backup_problem(now)
    assert key == "backup" and "40 小时" in msg


def test_backup_garbage_status_file_alerts(monitor, monkeypatch, tmp_path):
    status = tmp_path / "last_success"
    status.write_text("not-a-timestamp")
    monkeypatch.setattr(monitor.config, "BACKUP_STATUS_FILE", str(status))
    assert monitor.backup_problem(time.time())[0] == "backup"


async def test_alert_cooldown_survives_restart(monitor, monkeypatch):
    """部署重启后端不能让"每天最多一封"失效。"""
    now = time.time()
    assert monitor._should_alert("stalled-subscriptions", now) is True
    assert monitor.ALERT_STATE_FILE.exists()

    # 模拟重启：内存清空，重新从文件加载
    monitor._last_alert.clear()
    monkeypatch.setattr(monitor, "_state_loaded", False)
    assert monitor._should_alert("stalled-subscriptions", now + 3600) is False
    # 过了冷却期照常提醒
    assert monitor._should_alert("stalled-subscriptions", now + monitor.ALERT_COOLDOWN_SEC + 1) is True



def test_low_deepseek_balance_alert(monitor, monkeypatch):
    monkeypatch.setattr(monitor.config, "DEEPSEEK_BALANCE_ALERT_CNY", 20.0)
    assert monitor.balance_problem(None) is None        # 查不到余额时不误报
    assert monitor.balance_problem(35.5) is None
    key, msg = monitor.balance_problem(6.8)
    assert key == "deepseek-balance" and "¥6.80" in msg and "充值" in msg


# ── 低维护模式：磁盘、错误突增、推送失败、首个用户、周报 ─────────────────────

def test_disk_alert(monitor, monkeypatch):
    import collections
    monkeypatch.setattr(monitor.config, "DISK_ALERT_PERCENT", 90.0)
    Usage = collections.namedtuple("Usage", "total used free")
    monkeypatch.setattr("shutil.disk_usage", lambda p: Usage(100, 80, 20))
    assert monitor.disk_problem() is None
    monkeypatch.setattr("shutil.disk_usage", lambda p: Usage(100 * 1024**3, 93 * 1024**3, 7 * 1024**3))
    key, msg = monitor.disk_problem()
    assert key == "disk" and "93%" in msg


def test_error_spike_alert(monitor, monkeypatch):
    monkeypatch.setattr(monitor.config, "ERROR_SPIKE_THRESHOLD", 5)
    monkeypatch.setattr("logging_config.recent_error_count", lambda window_sec=3600: 4)
    assert monitor.error_spike_problem(time.time()) is None
    monkeypatch.setattr("logging_config.recent_error_count", lambda window_sec=3600: 9)
    key, msg = monitor.error_spike_problem(time.time())
    assert key == "error-spike" and "9 条错误" in msg


def test_error_counter_counts_only_errors():
    import logging
    from logging_config import setup_logging, get_logger, recent_error_count, _error_times
    setup_logging()
    _error_times.clear()
    log = get_logger("test.errors")
    log.info("普通日志")
    log.warning("警告")
    log.error("出错了")
    logging.getLogger("other").error("另一个模块出错")
    assert recent_error_count() == 2


async def test_push_failure_and_first_user_alerts(db_session, monitor):
    from services import stats
    assert await monitor.push_failure_problem(db_session) is None
    assert await monitor.first_real_user(db_session) is None

    await stats.bump(db_session, stats.PUSH_FAILED)
    key, msg = await monitor.push_failure_problem(db_session)
    assert key == "push-failed" and "1 封" in msg

    await stats.bump(db_session, stats.SEARCH, 3)
    key, msg = await monitor.first_real_user(db_session)
    assert key == "first-user" and "3 次搜索" in msg


def test_first_user_alert_fires_only_once(monitor):
    now = time.time()
    assert monitor._should_alert("first-user", now) is True
    assert monitor._should_alert("first-user", now + 10 * 86400) is False   # 不再重复
    assert monitor._should_alert("disk", now) is True
    assert monitor._should_alert("disk", now + 2 * 86400) is True           # 普通告警按天重复


async def test_weekly_report_skipped_without_activity(db_session, monkeypatch):
    from services import weekly_report
    data = await weekly_report.collect(db_session, days=7)
    assert data["has_activity"] is False

    from services import stats
    await stats.bump(db_session, stats.SEARCH, 2)
    await stats.bump(db_session, stats.PAGE_OPEN, 9)
    data = await weekly_report.collect(db_session, days=7)
    assert data["has_activity"] is True and data["search"] == 2 and data["page_open"] == 9


def test_weekly_summary_email_content():
    from datetime import datetime
    from services.weekly_report import _format
    from services.email_service import build_weekly_summary_html
    data = {"page_open": 120, "search": 14, "chat": 6, "register": 2, "feedback": 1, "push_failed": 1,
            "free_searches": 9, "free_chats": 4, "new_users": 2, "new_feedback": 1, "new_saved": 3,
            "new_sessions": 5, "new_subs": 1, "pushed": 21, "total_users": 26, "active_subs": 3}
    stats = _format(data, 56.66, datetime(2026, 9, 21))
    html = build_weekly_summary_html(stats)
    for text in ("周报", "14 次", "2 人", "¥56.66", "发送失败", "2026-09-14 至 2026-09-21"):
        assert text in html, text
    assert stats["headline"] == "本周 14 次搜索 · 2 人注册"
