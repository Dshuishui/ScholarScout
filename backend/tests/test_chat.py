"""免费论文对话：按人计次、上下文截断、失败退还。"""
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import sessionmaker

from models_db import TrialUsage, User
from tests.conftest import make_verified_user

DEVICE = "device-chat-aaaaaaaaaaa"
PAPER = {"paper_id": "p1", "title": "Gut microbiota and depression", "authors": ["A", "B"],
         "abstract": "The gut microbiota influences mood.", "source": "OpenAlex"}


def _body(**kw):
    return {"paper": PAPER, "question": "这篇论文的核心结论是什么？", "messages": [], **kw}


def _headers(device=DEVICE, ip="9.9.9.9", token=None):
    h = {"X-Real-IP": ip}
    if device:
        h["X-Trial-Device"] = device
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


class _Chunk:
    def __init__(self, text):
        self.choices = [type("C", (), {"delta": type("D", (), {"content": text})()})()]


def _fake_stream(texts=("论文", "结论是…")):
    async def _gen():
        for t in texts:
            yield _Chunk(t)

    async def create(**kwargs):
        create.kwargs = kwargs
        return _gen()
    return create


@pytest.fixture
def chat(monkeypatch, db_engine):
    import routers.chat as cr
    monkeypatch.setattr(cr.config, "DEEPSEEK_SYSTEM_KEY", "sk-system")
    monkeypatch.setattr(cr.config, "ANON_FREE_CHATS", 2)
    monkeypatch.setattr(cr.config, "ACCOUNT_FREE_CHATS", 5)
    monkeypatch.setattr(cr.config, "ANON_CHAT_PER_IP_DAY", 60)
    monkeypatch.setattr(cr.config, "CHAT_DAILY_CAP", 500)
    monkeypatch.setattr(cr, "AsyncSessionLocal", sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False))
    cr._chat_attempts.clear()

    create = _fake_stream()
    fake_client = type("Client", (), {"chat": type("C", (), {"completions": type("X", (), {"create": staticmethod(create)})()})()})
    monkeypatch.setattr(cr.openai, "AsyncOpenAI", lambda **kw: fake_client())
    return create


async def test_anonymous_visitor_gets_free_chats(client, db_session, chat):
    r = await client.post("/api/chat/paper", json=_body(), headers=_headers())
    assert r.status_code == 200
    assert '"remaining": 1' in r.text and "event: delta" in r.text and "结论是" in r.text

    assert (await client.post("/api/chat/paper", json=_body(), headers=_headers())).status_code == 200
    third = await client.post("/api/chat/paper", json=_body(), headers=_headers())
    assert third.status_code == 403 and third.json()["detail"]["code"] == "chats_exhausted"
    assert await db_session.scalar(
        select(func.count()).select_from(TrialUsage).where(TrialUsage.kind == "chat")) == 2


async def test_free_chats_do_not_consume_search_quota(client, db_session, chat):
    await client.post("/api/chat/paper", json=_body(), headers=_headers())
    searches = await db_session.scalar(
        select(func.count()).select_from(TrialUsage).where(TrialUsage.kind == "search"))
    assert searches == 0


async def test_account_chats_are_counted_and_refunded_on_failure(client, db_session, chat, monkeypatch):
    user, token = await make_verified_user(db_session, email="chat@test.com")
    user.free_chats = 2
    await db_session.commit()
    user_id = user.id

    r = await client.post("/api/chat/paper", json=_body(), headers=_headers(device=None, token=token))
    assert r.status_code == 200 and '"remaining": 1' in r.text
    db_session.expire_all()
    assert await db_session.scalar(select(User.free_chats).where(User.id == user_id)) == 1

    # 生成失败且一个字都没产出 → 退还
    import routers.chat as cr
    async def boom(**kw):
        raise RuntimeError("deepseek down")
    monkeypatch.setattr(cr.openai, "AsyncOpenAI",
                        lambda **kw: type("C", (), {"chat": type("X", (), {"completions": type("Y", (), {"create": staticmethod(boom)})()})()})())
    r = await client.post("/api/chat/paper", json=_body(), headers=_headers(device=None, token=token))
    assert "event: error" in r.text and '"refunded": true' in r.text
    db_session.expire_all()
    assert await db_session.scalar(select(User.free_chats).where(User.id == user_id)) == 1


async def test_exhausted_account_gets_clear_code(client, db_session, chat):
    _, token = await make_verified_user(db_session, email="nochat@test.com")
    # make_verified_user 默认 free_chats=30，先清零
    await db_session.execute(User.__table__.update().values(free_chats=0))
    await db_session.commit()
    r = await client.post("/api/chat/paper", json=_body(), headers=_headers(device=None, token=token))
    assert r.status_code == 403 and r.json()["detail"]["code"] == "chats_exhausted"


async def test_pdf_context_is_truncated_for_free_chats(client, db_session, chat, monkeypatch):
    """一篇 PDF 可能上百万字符，整篇送进去一条对话就要好几块钱。"""
    import routers.chat as cr
    monkeypatch.setattr(cr.config, "FREE_CHAT_CONTEXT_CHARS", 500)
    huge = "全文内容 " * 5000
    r = await client.post("/api/chat/paper", json=_body(pdf_text=huge), headers=_headers())
    assert r.status_code == 200
    sent = chat.kwargs["messages"]
    excerpt = next(m for m in sent if m["content"].startswith("【论文全文节选】"))
    assert len(excerpt["content"]) < 800
    assert "只截取了全文开头部分" in excerpt["content"]
    assert chat.kwargs["max_tokens"] == cr.config.FREE_CHAT_MAX_TOKENS


async def test_history_is_capped(client, db_session, chat):
    import routers.chat as cr
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"第{i}条 " + "x" * 5000}
               for i in range(20)]
    r = await client.post("/api/chat/paper", json=_body(messages=history), headers=_headers())
    assert r.status_code == 200
    sent = chat.kwargs["messages"]
    # system + 最近 8 条历史 + 本次提问
    assert len(sent) == 1 + cr.MAX_HISTORY_MESSAGES + 1
    assert all(len(m["content"]) <= cr.MAX_MESSAGE_CHARS + 200 for m in sent)


async def test_no_device_id_requires_key(client, chat):
    r = await client.post("/api/chat/paper", json=_body(), headers=_headers(device=None))
    assert r.status_code == 401 and r.json()["detail"]["code"] == "key_required"


async def test_trial_status_reports_chat_quota(client, db_session, chat):
    data = (await client.get("/api/trial/status", headers=_headers())).json()
    assert data["chats_remaining"] == 2 and data["chats_total"] == 2
    await client.post("/api/chat/paper", json=_body(), headers=_headers())
    data = (await client.get("/api/trial/status", headers=_headers())).json()
    assert data["chats_remaining"] == 1


# ── 标题翻译 ─────────────────────────────────────────────────────────────────

async def test_titles_are_translated_and_cached(client, monkeypatch):
    import routers.translate as tr
    monkeypatch.setattr(tr.config, "DEEPSEEK_SYSTEM_KEY", "sk-system")
    calls = []

    class Resp:
        def __init__(self, content):
            self.choices = [type("C", (), {"message": type("M", (), {"content": content})()})()]

    async def create(**kw):
        calls.append(kw)
        return Resp('{"translations": [{"i": 0, "zh": "肠道菌群与抑郁"}]}')

    monkeypatch.setattr(tr.openai, "AsyncOpenAI", lambda **kw: type("C", (), {
        "chat": type("X", (), {"completions": type("Y", (), {"create": staticmethod(create)})()})()})())

    body = {"titles": ["Gut microbiota and depression"]}
    r = await client.post("/api/translate/titles", json=body)
    assert r.json()["translations"]["Gut microbiota and depression"] == "肠道菌群与抑郁"

    r2 = await client.post("/api/translate/titles", json=body)
    assert r2.json()["translations"]["Gut microbiota and depression"] == "肠道菌群与抑郁"
    assert len(calls) == 1, "第二次应当命中服务端缓存，不再调用大模型"


async def test_translation_unavailable_without_system_key(client, monkeypatch):
    import routers.translate as tr
    monkeypatch.setattr(tr.config, "DEEPSEEK_SYSTEM_KEY", "")
    r = await client.post("/api/translate/titles", json={"titles": ["x"]})
    assert r.status_code == 503
