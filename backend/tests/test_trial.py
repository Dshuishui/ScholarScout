"""未登录免费体验：按设备 / IP / 全站每日上限计次，失败或无结果退还次数。"""
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

from models import Paper
from models_db import TrialUsage, User
from tests.conftest import make_verified_user

DEVICE_A = "device-aaaaaaaaaaaaaaaa"
DEVICE_B = "device-bbbbbbbbbbbbbbbb"
SEARCH_BODY = {"query": "rag", "keywords": ["retrieval augmented generation"]}


def _paper(i: int) -> Paper:
    return Paper(paper_id=f"p{i}", title=f"Paper {i}", authors=["A"], source="OpenAlex")


@pytest.fixture
def trial(monkeypatch, db_engine):
    """打开系统 Key，替换掉搜索流水线里所有外部调用。"""
    import routers.search as sr
    import config
    monkeypatch.setattr(sr, "DEEPSEEK_SYSTEM_KEY", "sk-system")
    monkeypatch.setattr(config, "ANON_TRIAL_SEARCHES", 2)
    monkeypatch.setattr(config, "ANON_TRIAL_PER_IP_DAY", 5)
    monkeypatch.setattr(config, "ANON_TRIAL_DAILY_CAP", 200)
    # 退还次数时路由自己开会话，指到测试库
    monkeypatch.setattr(sr, "AsyncSessionLocal", sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False))

    papers = [_paper(1), _paper(2)]
    pipeline = {
        "search_all_sources": AsyncMock(return_value=papers),
        "enhance_with_unpaywall": AsyncMock(side_effect=lambda p: p),
        "validate_papers": AsyncMock(return_value=(papers, [])),
        "get_cached_search": AsyncMock(return_value=None),
        "cache_search": AsyncMock(),
        "_index_papers_async": AsyncMock(),
    }
    for name, mock in pipeline.items():
        monkeypatch.setattr(sr, name, mock)
    return pipeline


async def _search(client, device=DEVICE_A, ip="1.1.1.1", headers=None, body=None):
    h = {"X-Real-IP": ip}
    if device:
        h["X-Trial-Device"] = device
    h.update(headers or {})
    return await client.post("/api/search", json=body or SEARCH_BODY, headers=h)


async def _usage_count(db_session) -> int:
    return await db_session.scalar(select(func.count()).select_from(TrialUsage))


async def test_anonymous_visitor_gets_two_free_searches(client, db_session, trial):
    first = await _search(client)
    assert first.status_code == 200
    assert 'event: quota\ndata: {"remaining": 1, "kind": "anon"}' in first.text
    assert "event: done" in first.text
    assert (await _search(client)).status_code == 200

    third = await _search(client)
    assert third.status_code == 403
    assert third.json()["detail"]["code"] == "trial_exhausted"
    assert await _usage_count(db_session) == 2


async def test_trial_status_reports_remaining(client, db_session, trial):
    headers = {"X-Trial-Device": DEVICE_A, "X-Real-IP": "1.1.1.1"}
    data = (await client.get("/api/trial/status", headers=headers)).json()
    assert data["enabled"] is True and data["anon_remaining"] == 2 and data["signup_bonus"] == 3
    await _search(client)
    data = (await client.get("/api/trial/status", headers=headers)).json()
    assert data["anon_remaining"] == 1


async def test_same_ip_cannot_farm_trials_with_new_devices(client, db_session, trial, monkeypatch):
    import config
    monkeypatch.setattr(config, "ANON_TRIAL_PER_IP_DAY", 3)
    for i in range(3):
        assert (await _search(client, device=f"device-{i:016d}")).status_code == 200
    r = await _search(client, device="device-9999999999999999")
    assert r.json()["detail"]["code"] == "trial_exhausted"
    # 换一个 IP 的新访客不受影响
    assert (await _search(client, device=DEVICE_B, ip="2.2.2.2")).status_code == 200


async def test_ip_limit_is_a_rolling_day(client, db_session, trial, monkeypatch):
    import config
    from services.trial_service import _digest
    monkeypatch.setattr(config, "ANON_TRIAL_PER_IP_DAY", 1)
    db_session.add(TrialUsage(device_hash=_digest("device", DEVICE_B), ip_hash=_digest("ip", "1.1.1.1"),
                              created_at=datetime.utcnow() - timedelta(days=2)))
    await db_session.commit()
    assert (await _search(client)).status_code == 200


async def test_site_wide_daily_cap(client, db_session, trial, monkeypatch):
    import config
    monkeypatch.setattr(config, "ANON_TRIAL_DAILY_CAP", 1)
    assert (await _search(client)).status_code == 200
    r = await _search(client, device=DEVICE_B, ip="2.2.2.2")
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "trial_capacity"


async def test_missing_or_malformed_device_id_requires_key(client, trial):
    for device in (None, "short", "bad id with spaces!!!!"):
        r = await _search(client, device=device)
        assert r.status_code == 401
        assert r.json()["detail"]["code"] == "key_required"


async def test_no_system_key_means_no_trial(client, trial, monkeypatch):
    import routers.search as sr
    monkeypatch.setattr(sr, "DEEPSEEK_SYSTEM_KEY", "")
    r = await _search(client)
    assert r.status_code == 401 and r.json()["detail"]["code"] == "key_required"


async def test_refund_when_no_papers_found(client, db_session, trial):
    trial["search_all_sources"].return_value = []
    r = await _search(client)
    assert '"refunded": true, "remaining": 2' in r.text
    assert await _usage_count(db_session) == 0


async def test_refund_when_nothing_passes_validation(client, db_session, trial):
    trial["validate_papers"].return_value = ([], [_paper(1)])
    r = await _search(client)
    assert '"refunded": true' in r.text
    assert await _usage_count(db_session) == 0


async def test_refund_when_pipeline_crashes(client, db_session, trial):
    trial["validate_papers"].side_effect = RuntimeError("deepseek down")
    r = await _search(client)
    assert "event: error" in r.text and '"refunded": true' in r.text
    assert await _usage_count(db_session) == 0


async def test_own_key_does_not_touch_trial(client, db_session, trial):
    r = await _search(client, device=None, body={**SEARCH_BODY, "api_key": "sk-mine"})
    assert r.status_code == 200 and "event: quota" not in r.text
    assert await _usage_count(db_session) == 0


async def test_trial_search_cannot_inflate_llm_cost(client, trial):
    body = {**SEARCH_BODY, "limit_per_source": 200, "validated_limit": 500}
    await _search(client, body=body)
    assert trial["search_all_sources"].await_args.kwargs["limit_per_source"] == 50


async def test_account_free_searches_refunded_on_failure(client, db_session, trial):
    user, token = await make_verified_user(db_session, email="free@test.com")
    user.free_searches = 1
    await db_session.commit()
    user_id = user.id
    trial["search_all_sources"].return_value = []
    r = await _search(client, device=None, headers={"Authorization": f"Bearer {token}"})
    assert '"kind": "account"' in r.text and '"refunded": true' in r.text
    db_session.expire_all()
    assert await db_session.scalar(select(User.free_searches).where(User.id == user_id)) == 1


async def test_account_credits_exhausted_code(client, db_session, trial):
    _, token = await make_verified_user(db_session, email="zero@test.com")
    r = await _search(client, device=None, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "credits_exhausted"


async def test_anonymous_parse_checks_quota_without_charging(client, db_session, trial, monkeypatch):
    import routers.search as sr
    monkeypatch.setattr(sr, "classify_intent", AsyncMock(return_value={"intent": "chat", "reply": "hi"}))
    headers = {"X-Trial-Device": DEVICE_A, "X-Real-IP": "1.1.1.1"}
    assert (await client.post("/api/parse", json={"query": "hello"}, headers=headers)).status_code == 200
    assert await _usage_count(db_session) == 0
    await _search(client)
    await _search(client)
    r = await client.post("/api/parse", json={"query": "hello"}, headers=headers)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "trial_exhausted"


async def test_purge_removes_old_usage(db_session):
    from services.trial_service import purge_old_usage
    now = datetime.utcnow()
    db_session.add_all([
        TrialUsage(device_hash="a", ip_hash="a", created_at=now - timedelta(days=91)),
        TrialUsage(device_hash="b", ip_hash="b", created_at=now - timedelta(days=1)),
    ])
    await db_session.commit()
    assert await purge_old_usage(db_session, now) == 1
    assert await _usage_count(db_session) == 1


def test_identifiers_are_not_stored_in_plain_text():
    from services.trial_service import _digest
    assert "1.1.1.1" not in _digest("ip", "1.1.1.1")
    assert _digest("ip", "1.1.1.1") != _digest("device", "1.1.1.1")


def _status_error(status: int):
    import httpx
    import openai
    req = httpx.Request("POST", "https://api.deepseek.com/chat/completions")
    return openai.APIStatusError("boom", response=httpx.Response(status, request=req), body=None)


@pytest.mark.parametrize("status,code", [(401, "invalid_key"), (402, "insufficient_balance"), (500, "llm_unavailable")])
async def test_parse_maps_own_key_errors(client, monkeypatch, status, code):
    import routers.search as sr
    monkeypatch.setattr(sr, "classify_intent", AsyncMock(side_effect=_status_error(status)))
    r = await client.post("/api/parse", json={"query": "hello", "api_key": "sk-bad"})
    assert r.status_code in (401, 402, 502) and r.json()["detail"]["code"] == code


async def test_system_key_failure_is_not_blamed_on_visitor(client, trial, monkeypatch):
    import routers.search as sr
    monkeypatch.setattr(sr, "classify_intent", AsyncMock(side_effect=_status_error(401)))
    headers = {"X-Trial-Device": DEVICE_A, "X-Real-IP": "1.1.1.1"}
    r = await client.post("/api/parse", json={"query": "hello"}, headers=headers)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "trial_unavailable"


# ── 边搜边出结果 ──────────────────────────────────────────────────────────────

async def test_search_streams_partial_results_before_validation(client, trial, monkeypatch):
    """搜索要 1 分钟左右，用户不应该一直盯着进度条：每个源回来就先推一批原始结果。"""
    import asyncio
    import routers.search as sr
    from services import search_service as real

    async def fake_search_all(parsed, limit_per_source=50, sources=None, on_source_done=None):
        await on_source_done("OpenAlex", 2, [_paper(1), _paper(2)])
        await asyncio.sleep(0.2)  # 给 SSE 循环机会把预览推出去
        await on_source_done("CrossRef", 1, [_paper(3)])
        await asyncio.sleep(0.2)
        return real.deduplicate([_paper(1), _paper(2), _paper(3)])

    monkeypatch.setattr(sr, "search_all_sources", fake_search_all)
    monkeypatch.setattr(sr, "validate_papers", AsyncMock(return_value=([_paper(1)], [])))
    r = await _search(client)
    assert r.status_code == 200
    partials = [line for line in r.text.splitlines() if line.startswith("event: partial")]
    assert partials, "没有推送任何预览结果"
    assert '"total": 3' in r.text        # 预览里累计的是去重后的篇数
    assert "event: done" in r.text       # 最终仍然返回 AI 筛选后的结果


async def test_sources_endpoint_lists_only_usable_sources(client, monkeypatch):
    from services import search_service as s
    for attr in ("CORE_API_KEY", "NASA_ADS_API_KEY", "SERPAPI_KEY"):
        monkeypatch.setattr(s.config, attr, "")
    names = (await client.get("/api/sources")).json()["sources"]
    assert "OpenAlex" in names
    assert "CORE" not in names and "Google Scholar" not in names


async def test_cache_hit_does_not_consume_a_free_search(client, db_session, trial, monkeypatch):
    """重复搜同一个问题命中缓存时没有任何大模型调用，不应该再扣一次免费次数。"""
    import routers.search as sr
    monkeypatch.setattr(sr, "get_cached_search", AsyncMock(return_value=[_paper(1).model_dump()]))
    r = await _search(client)
    assert "event: cache_hit" in r.text
    assert '"refunded": true, "remaining": 2' in r.text
    assert await _usage_count(db_session) == 0
