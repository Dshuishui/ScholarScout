"""APScheduler 定时任务：每周一 08:00 CST（UTC 00:00）给活跃订阅发送新论文邮件。"""
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


async def send_weekly_subscriptions() -> None:
    """遍历所有活跃订阅，搜索新论文并发送邮件。"""
    logger.info("Weekly subscription job started")
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        # 取所有活跃订阅 + 用户邮箱
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


async def _process_subscription(sub: Subscription, email: str, now: datetime) -> None:
    keywords: list[str] = json.loads(sub.keywords_json)
    if not keywords:
        return

    # date_from：上次发送时间；首次发送取过去 7 天
    if sub.last_sent:
        date_from = sub.last_sent.strftime("%Y-%m-%d")
    else:
        date_from = (now - timedelta(days=7)).strftime("%Y-%m-%d")

    parsed = ParsedQuery(keywords=keywords, date_from=date_from, max_results=50)

    # 搜索（不需要 AI 解析，关键词直接用）
    all_papers = await search_all_sources(parsed, limit_per_source=15)

    # 按发表日期过滤：只保留 date_from 之后的论文
    new_papers = [
        p for p in all_papers
        if p.published_date and p.published_date >= date_from
    ]

    if not new_papers:
        logger.info("No new papers for subscription %d (%s)", sub.id, email)
        # 即使没有新论文也更新 last_sent，避免下次重复查太早的文献
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Subscription).where(Subscription.id == sub.id))
            s = result.scalar_one_or_none()
            if s:
                s.last_sent = now.replace(tzinfo=None)
                await db.commit()
        return

    # 可选：AI 筛选（需要服务器端 DeepSeek Key）
    if DEEPSEEK_API_KEY:
        try:
            from services.llm_service import validate_papers
            query_str = " ".join(keywords)
            accepted, _ = await validate_papers(new_papers, query_str, DEEPSEEK_API_KEY)
            if accepted:
                new_papers = accepted
        except Exception as e:
            logger.warning("AI validation skipped for sub %d: %s", sub.id, e)

    # 最多发 30 篇
    new_papers = new_papers[:30]

    # 发送邮件
    sent = await send_subscription_email(email, keywords, new_papers)

    # 更新 last_sent
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Subscription).where(Subscription.id == sub.id))
        s = result.scalar_one_or_none()
        if s:
            s.last_sent = now.replace(tzinfo=None)
            await db.commit()

    if sent:
        logger.info("Sent %d papers to %s for sub %d", len(new_papers), email, sub.id)


def setup_scheduler() -> AsyncIOScheduler:
    """注册定时任务并返回 scheduler 实例（供 lifespan 使用）。"""
    # 每周一 00:00 UTC = 周一 08:00 CST
    scheduler.add_job(
        send_weekly_subscriptions,
        trigger=CronTrigger(day_of_week="mon", hour=0, minute=0),
        id="weekly_subscriptions",
        replace_existing=True,
        misfire_grace_time=3600,  # 允许最多 1 小时的错过补跑
    )
    return scheduler
