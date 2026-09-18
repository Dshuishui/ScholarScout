"""每周汇总邮件：这一周有人用才发，没人用就完全不打扰。

数据全部来自我们自己的数据库（site_counters + 各业务表），不依赖 Umami。
"""
from datetime import datetime, timedelta

from sqlalchemy import func, select

from logging_config import get_logger
from models_db import Feedback, SavedPaper, SearchSession, Subscription, SubscriptionQueueItem, TrialUsage, User
from services import stats as stats_service

logger = get_logger(__name__)


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
        "free_searches": free_searches,
        "free_chats": free_chats,
        "new_users": await count(User, User.created_at),
        "new_feedback": await count(Feedback, Feedback.created_at),
        "new_saved": await count(SavedPaper, SavedPaper.saved_at),
        "new_sessions": await count(SearchSession, SearchSession.created_at),
        "new_subs": await count(Subscription, Subscription.created_at),
        "pushed": pushed,
        "total_users": int(await db.scalar(select(func.count()).select_from(User)) or 0),
        "active_subs": int(await db.scalar(
            select(func.count()).select_from(Subscription).where(Subscription.active == True)) or 0),  # noqa: E712
    }
    data["has_activity"] = any(data[k] for k in ("search", "chat", "register", "feedback", "new_users", "new_saved"))
    return data


def _format(data: dict, balance: float | None, now: datetime) -> dict:
    start = (now - timedelta(days=7)).strftime("%Y-%m-%d")
    rows = [
        ("打开网站", f"{data['page_open']} 次"),
        ("完成搜索", f"{data['search']} 次"),
        ("论文对话", f"{data['chat']} 次"),
        ("新注册用户", f"{data['register']} 人"),
        ("新留言", f"{data['new_feedback']} 条"),
        ("收藏论文", f"{data['new_saved']} 篇"),
        ("订阅推送", f"{data['pushed']} 篇"),
    ]
    notes = [
        f"免费额度消耗：搜索 {data['free_searches']} 次、对话 {data['free_chats']} 次（未登录访客）",
        f"累计注册 {data['total_users']} 人 · 启用中的订阅 {data['active_subs']} 个",
    ]
    if balance is not None:
        notes.append(f"DeepSeek 余额：¥{balance:.2f}")
    if data["push_failed"]:
        notes.append(f"⚠️ 有 {data['push_failed']} 封订阅推送邮件发送失败，需要检查")
    if data["search"] and not data["register"]:
        notes.append("有人搜索但没人注册：可以看看注册引导是不是不够清楚")

    headline = f"本周 {data['search']} 次搜索 · {data['register']} 人注册"
    return {"period": f"{start} 至 {now.strftime('%Y-%m-%d')}（UTC）",
            "headline": headline, "rows": rows, "notes": notes}


async def run_weekly_report(force: bool = False) -> bool:
    """定时任务入口。返回是否真的发出了邮件。"""
    from database import AsyncSessionLocal
    from services.email_service import send_weekly_summary
    from services.health_monitor import deepseek_balance

    now = datetime.utcnow()
    async with AsyncSessionLocal() as db:
        data = await collect(db, days=7, now=now)
    if not data["has_activity"] and not force:
        logger.info("Weekly summary skipped: no activity")
        return False
    balance = await deepseek_balance()
    return await send_weekly_summary(_format(data, balance, now))
