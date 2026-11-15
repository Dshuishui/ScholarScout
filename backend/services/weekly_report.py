"""每周汇总邮件，每周一都发：没人用的那周标题写"本周没人使用"。

数据全部来自我们自己的数据库（site_counters + 各业务表），不依赖 Umami。
"""
from datetime import datetime, timedelta

from sqlalchemy import func, select

import config
from models_db import Feedback, SavedPaper, SearchSession, Subscription, SubscriptionQueueItem, TrialUsage, User
from services import stats as stats_service
from services.health_monitor import SOURCE_CALL_PREFIX, SOURCE_ERROR_PREFIX

SOURCE_BROKEN_RATIO = 0.5   # 一周里一半以上的调用都出错，就在周报里标出来
SOURCE_BROKEN_MIN_CALLS = 3


def _source_stats(counters: dict[str, int]) -> dict[str, dict[str, int]]:
    """{源名: {"calls": 调用次数, "errors": 出错次数}}"""
    out: dict[str, dict[str, int]] = {}
    for name, n in counters.items():
        for prefix, field in ((SOURCE_CALL_PREFIX, "calls"), (SOURCE_ERROR_PREFIX, "errors")):
            if name.startswith(prefix):
                out.setdefault(name[len(prefix):], {"calls": 0, "errors": 0})[field] += n
    return out


def _source_notes(sources: dict[str, dict[str, int]]) -> list[str]:
    """周报里关于数据源的几行：哪些源本周出过错，几乎全错的单独标警告。"""
    if not sources:
        return []
    failing = sorted(((name, s["errors"], s["calls"]) for name, s in sources.items() if s["errors"]),
                     key=lambda x: (-x[1] / max(x[2], 1), x[0]))
    total = sum(s["calls"] for s in sources.values())
    if not failing:
        return [f"数据源本周没有出错（共调用 {total} 次）"]
    notes = ["数据源出错次数（本周）：" + "、".join(f"{name} {e}/{c} 次" for name, e, c in failing)]
    for name, errors, calls in failing:
        if calls >= SOURCE_BROKEN_MIN_CALLS and errors / calls >= SOURCE_BROKEN_RATIO:
            hint = "（没有 API Key 时一直被限流，申请到 Key 后填进 .env 即可）" \
                if name == "Semantic Scholar" and not config.SEMANTIC_SCHOLAR_API_KEY else "，需要检查"
            notes.append(f"⚠️ {name} 本周 {calls} 次调用里 {errors} 次出错，基本不可用{hint}")
    return notes



async def collect(db, days: int = 7, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    since = now - timedelta(days=days)
    counters = await stats_service.totals(db, days, now)

    async def count(model, column):
        return int(await db.scalar(select(func.count()).select_from(model).where(column >= since)) or 0)

    free_searches = int(await db.scalar(
        select(func.count()).select_from(TrialUsage)
        .where(TrialUsage.kind == "search", TrialUsage.created_at >= since)) or 0)
    free_chats = int(await db.scalar(
        select(func.count()).select_from(TrialUsage)
        .where(TrialUsage.kind == "chat", TrialUsage.created_at >= since)) or 0)
    pushed = int(await db.scalar(
        select(func.count()).select_from(SubscriptionQueueItem)
        .where(SubscriptionQueueItem.sent_at >= since)) or 0)

    data = {
        "page_open": counters.get(stats_service.PAGE_OPEN, 0),
        "search": counters.get(stats_service.SEARCH, 0),
        "chat": counters.get(stats_service.CHAT, 0),
        "register": counters.get(stats_service.REGISTER, 0),
        "feedback": counters.get(stats_service.FEEDBACK, 0),
        "push_failed": counters.get(stats_service.PUSH_FAILED, 0),
        "export": counters.get(stats_service.EXPORT, 0),
        "library_import": counters.get(stats_service.LIBRARY_IMPORT, 0),
        "more_papers": counters.get(stats_service.MORE_PAPERS, 0),
        "free_searches": free_searches,
        "free_chats": free_chats,
        "new_users": await count(User, User.created_at),
        "new_feedback": await count(Feedback, Feedback.created_at),
        "new_saved": await count(SavedPaper, SavedPaper.saved_at),
        "new_sessions": await count(SearchSession, SearchSession.created_at),
        "new_subs": await count(Subscription, Subscription.created_at),
        "pushed": pushed,
        "sources": _source_stats(counters),
        "total_users": int(await db.scalar(select(func.count()).select_from(User)) or 0),
        "active_subs": int(await db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.active == True)) or 0),  # noqa: E712
    }
    data["has_activity"] = any(data[k] for k in ("search", "chat", "register", "feedback", "new_users", "new_saved",
                                                 "export", "library_import"))
    return data


def _format(data: dict, balance: float | None, now: datetime, openalex: dict | None = None) -> dict:
    start = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    rows = [
        ("打开网站", f"{data['page_open']} 次"),
        ("完成搜索", f"{data['search']} 次"),
        ("论文对话", f"{data['chat']} 次"),
        ("新注册用户", f"{data['register']} 人"),
        ("新留言", f"{data['new_feedback']} 条"),
        ("收藏论文", f"{data['new_saved']} 篇"),
        ("订阅推送", f"{data['pushed']} 篇"),
        ("导出文献", f"{data.get('export', 0)} 次"),
        ("从 Zotero 导入", f"{data.get('library_import', 0)} 次"),
    ]
    notes = [
        f"免费额度消耗：搜索 {data['free_searches']} 次、对话 {data['free_chats']} 次（未登录访客）",
        f"累计注册 {data['total_users']} 人 · 启用中的订阅 {data['active_subs']} 个",
    ]
    if data.get("more_papers"):
        notes.append(f"首批结果之后又补充了 {data['more_papers']} 篇论文（引用链 + 换词检索）")
    if balance is not None:
        notes.append(f"DeepSeek 余额：¥{balance:.2f}")
    if openalex:
        notes.append(f"OpenAlex 今日剩余额度：${openalex['remaining']:.3f} / ${openalex['limit']:.2f}")
    notes.extend(_source_notes(data.get("sources") or {}))
    if data["push_failed"]:
        notes.append(f"⚠️ 有 {data['push_failed']} 封订阅推送邮件发送失败，需要检查")
    if data["search"] and not data["register"]:
        notes.append("有人搜索但没人注册：可以看看注册引导是不是不够清楚")

    if data.get("has_activity", True):
        headline = f"本周 {data['search']} 次搜索 · {data['register']} 人注册"
    else:
        headline = "本周没人使用"
        notes.insert(0, "这一周没人搜索、对话或注册。周报每周一都会发，哪周没收到就是发信出了问题")
    return {"period": f"{start} 至 {now.strftime('%Y-%m-%d')}（UTC）",
            "headline": headline, "rows": rows, "notes": notes}


async def run_weekly_report() -> bool:
    """定时任务入口。返回是否真的发出了邮件。

    没人用的那周也发：以前那周直接跳过，站长收不到信时分不清是没人用还是发信坏了（2026-11-09）。
    """
    from database import AsyncSessionLocal
    from services.email_service import send_weekly_summary
    from services.health_monitor import deepseek_balance, openalex_budget

    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        data = await collect(db, days=7, now=now)
    balance = await deepseek_balance()
    return await send_weekly_summary(_format(data, balance, now, openalex_budget()))
