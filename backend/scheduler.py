"""APScheduler 定时任务：每天 08:00 CST（UTC 00:00）从推送队列取论文发送邮件。"""
import json
import logging
from datetime import datetime, timedelta, timezone, date

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select, func

from database import AsyncSessionLocal
from models_db import Subscription, SubscriptionQueueItem, User
from models import ParsedQuery, Paper
from services.search_service import search_all_sources
from services.email_service import send_subscription_email
from config import DEEPSEEK_API_KEY

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()

# ─────────────────────────────────────────────────────────────
# 队列填充
# ─────────────────────────────────────────────────────────────

async def populate_queue(
    sub: Subscription,
    db,
    now: datetime,
    search_days: int = 30,
    max_add: int = 30,
) -> int:
    """搜索论文并追加到订阅队列（跳过已存在的 paper_id）。
    返回新加入队列的论文数。
    """
    keywords: list[str] = json.loads(sub.keywords_json)
    if not keywords:
        return 0

    date_from = (now - timedelta(days=search_days)).strftime("%Y-%m-%d")
    parsed = ParsedQuery(keywords=keywords, date_from=date_from, max_results=60)
    try:
        all_papers = await search_all_sources(parsed, limit_per_source=15)
    except Exception as e:
        logger.warning("Search failed for sub %d: %s", sub.id, e)
        return 0

    # 可选 AI 过滤
    if DEEPSEEK_API_KEY and all_papers:
        try:
            from services.llm_service import validate_papers
            accepted, _ = await validate_papers(all_papers, " ".join(keywords), DEEPSEEK_API_KEY)
            if accepted:
                all_papers = accepted
        except Exception as e:
            logger.warning("AI validation skipped for sub %d: %s", sub.id, e)

    # 获取已存在的 paper_id（已发和待发都算）
    existing_result = await db.execute(
        select(SubscriptionQueueItem.paper_id)
        .where(SubscriptionQueueItem.subscription_id == sub.id)
    )
    existing_ids: set[str] = set(existing_result.scalars().all())

    new_papers = [p for p in all_papers if p.paper_id not in existing_ids]
    if not new_papers:
        logger.info("No new papers to add to queue for sub %d", sub.id)
        return 0

    # 找最后一个待发日期，从其后一天开始排队
    last_pending_result = await db.execute(
        select(SubscriptionQueueItem.planned_date)
        .where(
            SubscriptionQueueItem.subscription_id == sub.id,
            SubscriptionQueueItem.sent_at.is_(None),
        )
        .order_by(SubscriptionQueueItem.planned_date.desc())
        .limit(1)
    )
    last_pending = last_pending_result.scalar_one_or_none()

    today = now.date()
    if last_pending:
        start = max(today + timedelta(days=1), date.fromisoformat(last_pending) + timedelta(days=1))
    else:
        start = today + timedelta(days=1)

    added = 0
    for i, paper in enumerate(new_papers[:max_add]):
        item = SubscriptionQueueItem(
            subscription_id=sub.id,
            paper_json=json.dumps(paper.model_dump(), ensure_ascii=False, default=str),
            paper_id=paper.paper_id,
            planned_date=(start + timedelta(days=i // max(1, sub.daily_limit))).isoformat(),
        )
        db.add(item)
        added += 1

    await db.commit()
    logger.info("Added %d papers to queue for sub %d", added, sub.id)
    return added


# ─────────────────────────────────────────────────────────────
# 每日发送任务
# ─────────────────────────────────────────────────────────────

async def send_daily_subscriptions() -> None:
    logger.info("Daily subscription job started")
    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

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
            await _send_from_queue(sub, user.email, today_str, now)
        except Exception:
            logger.exception("Failed subscription %d for %s", sub.id, user.email)


async def _send_from_queue(
    sub: Subscription,
    email: str,
    today_str: str,
    now: datetime,
) -> None:
    keywords: list[str] = json.loads(sub.keywords_json)
    daily_limit = max(1, sub.daily_limit or 1)

    async with AsyncSessionLocal() as db:
        # 取今天及之前应发但未发的条目
        pending_result = await db.execute(
            select(SubscriptionQueueItem)
            .where(
                SubscriptionQueueItem.subscription_id == sub.id,
                SubscriptionQueueItem.planned_date <= today_str,
                SubscriptionQueueItem.sent_at.is_(None),
            )
            .order_by(SubscriptionQueueItem.planned_date.asc())
            .limit(daily_limit)
        )
        items = pending_result.scalars().all()

        if not items:
            logger.info("Queue empty for sub %d, attempting refresh", sub.id)
            # 队列空了，尝试补充（先 reload sub 以获得最新状态）
            sub_result = await db.execute(select(Subscription).where(Subscription.id == sub.id))
            sub_fresh = sub_result.scalar_one_or_none()
            if sub_fresh:
                await populate_queue(sub_fresh, db, now)
            return

        # 构造 Paper 对象
        papers = []
        for item in items:
            try:
                data = json.loads(item.paper_json)
                papers.append(Paper(**data))
            except Exception as e:
                logger.warning("Bad paper_json in queue item %d: %s", item.id, e)

        if not papers:
            return

        sent = await send_subscription_email(email, keywords, papers)

        if sent:
            sent_dt = now.replace(tzinfo=None)
            for item in items:
                item.sent_at = sent_dt
            # 更新 sub.last_sent
            sub_result = await db.execute(select(Subscription).where(Subscription.id == sub.id))
            sub_db = sub_result.scalar_one_or_none()
            if sub_db:
                sub_db.last_sent = sent_dt
            await db.commit()
            logger.info("Sent %d papers to %s for sub %d", len(papers), email, sub.id)

        # 队列剩余不足 5 篇时，后台补充
        remaining_result = await db.execute(
            select(func.count(SubscriptionQueueItem.id))
            .where(
                SubscriptionQueueItem.subscription_id == sub.id,
                SubscriptionQueueItem.sent_at.is_(None),
            )
        )
        remaining = remaining_result.scalar_one()
        if remaining < 5:
            sub_result2 = await db.execute(select(Subscription).where(Subscription.id == sub.id))
            sub_fresh2 = sub_result2.scalar_one_or_none()
            if sub_fresh2:
                await populate_queue(sub_fresh2, db, now)


# ─────────────────────────────────────────────────────────────
# 兼容旧接口（test-send 用）
# ─────────────────────────────────────────────────────────────

async def _process_subscription(
    sub: Subscription,
    email: str,
    now: datetime,
    force_days: int | None = None,
) -> dict:
    """test-send 专用：直接搜索并发送，不经过队列，不更新 last_sent。"""
    keywords: list[str] = json.loads(sub.keywords_json)
    if not keywords:
        return {"sent": False, "count": 0, "reason": "no keywords"}

    days = force_days if force_days is not None else 7
    date_from = (now - timedelta(days=days)).strftime("%Y-%m-%d")
    parsed = ParsedQuery(keywords=keywords, date_from=date_from, max_results=50)
    all_papers = await search_all_sources(parsed, limit_per_source=15)

    new_papers = [p for p in all_papers if p.published_date and p.published_date >= date_from]

    if not new_papers:
        return {"sent": False, "count": 0, "reason": "no new papers"}

    if DEEPSEEK_API_KEY:
        try:
            from services.llm_service import validate_papers
            accepted, _ = await validate_papers(new_papers, " ".join(keywords), DEEPSEEK_API_KEY)
            if accepted:
                new_papers = accepted
        except Exception as e:
            logger.warning("AI validation skipped: %s", e)

    daily_limit = max(1, sub.daily_limit or 1)
    new_papers = new_papers[:daily_limit]

    sent = await send_subscription_email(email, keywords, new_papers)
    return {"sent": sent, "count": len(new_papers) if sent else 0}


# ─────────────────────────────────────────────────────────────
# Scheduler 注册
# ─────────────────────────────────────────────────────────────

def setup_scheduler() -> AsyncIOScheduler:
    scheduler.add_job(
        send_daily_subscriptions,
        trigger=CronTrigger(hour=0, minute=0),
        id="daily_subscriptions",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    return scheduler
