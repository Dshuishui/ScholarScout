"""APScheduler 定时任务：每天 08:00 CST（UTC 00:00）给活跃订阅发送新论文邮件。"""
import json
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from database import AsyncSessionLocal
from models_db import Subscription, User
from models import ParsedQuery
from services.search_service import search_all_sources
from services.email_service import send_subscription_email
from config import DEEPSEEK_API_KEY

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def send_daily_subscriptions() -> None:
    """遍历所有活跃订阅，搜索新论文并发送邮件。"""
    logger.info("Daily subscription job started")
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        subs_result = await db.execute(
            select(Subscription, User)
            .join(User, User.id == Subscription.user_id)
            .where(Subscription.active == True)  # noqa: E712
        )
        rows = subs_result.all()

    logger.info("Processing %d active subscriptions", len(rows))

    for sub, user in rows:
        try:
            await _process_subscription(sub, user.email, now)
        except Exception:
            logger.exception("Failed to process subscription %d for %s", sub.id, user.email)


async def _process_subscription(
    sub: Subscription,
    email: str,
    now: datetime,
    force_days: int | None = None,
) -> dict:
    """搜索并发送邮件。force_days 不为 None 时忽略 last_sent，固定取最近 N 天。"""
    keywords: list[str] = json.loads(sub.keywords_json)
    if not keywords:
        return {"sent": False, "count": 0, "reason": "no keywords"}

    if force_days is not None:
        date_from = (now - timedelta(days=force_days)).strftime("%Y-%m-%d")
    elif sub.last_sent:
        date_from = sub.last_sent.strftime("%Y-%m-%d")
    else:
        date_from = (now - timedelta(days=1)).strftime("%Y-%m-%d")

    parsed = ParsedQuery(keywords=keywords, date_from=date_from, max_results=50)
    all_papers = await search_all_sources(parsed, limit_per_source=15)

    new_papers = [
        p for p in all_papers
        if p.published_date and p.published_date >= date_from
    ]

    if not new_papers:
        logger.info("No new papers for subscription %d (%s)", sub.id, email)
        if force_days is None:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Subscription).where(Subscription.id == sub.id))
                s = result.scalar_one_or_none()
                if s:
                    s.last_sent = now.replace(tzinfo=None)
                    await db.commit()
        return {"sent": False, "count": 0, "reason": "no new papers"}

    # 可选：AI 筛选
    if DEEPSEEK_API_KEY:
        try:
            from services.llm_service import validate_papers
            accepted, _ = await validate_papers(new_papers, " ".join(keywords), DEEPSEEK_API_KEY)
            if accepted:
                new_papers = accepted
        except Exception as e:
            logger.warning("AI validation skipped for sub %d: %s", sub.id, e)

    new_papers = new_papers[:30]
    sent = await send_subscription_email(email, keywords, new_papers)

    if force_days is None and sent:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Subscription).where(Subscription.id == sub.id))
            s = result.scalar_one_or_none()
            if s:
                s.last_sent = now.replace(tzinfo=None)
                await db.commit()

    if sent:
        logger.info("Sent %d papers to %s for sub %d", len(new_papers), email, sub.id)

    return {"sent": sent, "count": len(new_papers) if sent else 0}


def setup_scheduler() -> AsyncIOScheduler:
    """注册定时任务并返回 scheduler 实例（供 lifespan 使用）。"""
    # 每天 00:00 UTC = 08:00 CST
    scheduler.add_job(
        send_daily_subscriptions,
        trigger=CronTrigger(hour=0, minute=0),
        id="daily_subscriptions",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    return scheduler
