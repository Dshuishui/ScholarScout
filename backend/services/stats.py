"""站点计数：给每周汇总邮件提供真实数字。

只记数量，不记任何个人信息。写失败一律忽略——统计不能影响正常功能。
"""
from datetime import datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from logging_config import get_logger
from models_db import SiteCounter

logger = get_logger(__name__)

# 计数项：页面打开、完成搜索、免费对话、注册、留言、订阅推送失败
PAGE_OPEN = "page_open"
SEARCH = "search"
CHAT = "chat"
REGISTER = "register"
FEEDBACK = "feedback"
PUSH_FAILED = "push_failed"


async def bump(db: AsyncSession, name: str, n: int = 1, day: str | None = None) -> None:
    day = day or datetime.utcnow().strftime("%Y-%m-%d")
    try:
        result = await db.execute(
            update(SiteCounter).where(SiteCounter.day == day, SiteCounter.name == name)
            .values(count=SiteCounter.count + n).execution_options(synchronize_session=False)
        )
        if result.rowcount == 0:
            db.add(SiteCounter(day=day, name=name, count=n))
        await db.commit()
    except Exception as e:  # 统计失败不能影响业务
        logger.info("Counter %s bump failed: %s", name, e)
        await db.rollback()


async def totals(db: AsyncSession, days: int, until: datetime | None = None) -> dict[str, int]:
    """最近 days 天各计数项的合计。"""
    until = until or datetime.utcnow()
    since = (until - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = (await db.execute(
        select(SiteCounter.name, func.sum(SiteCounter.count))
        .where(SiteCounter.day >= since, SiteCounter.day <= until.strftime("%Y-%m-%d"))
        .group_by(SiteCounter.name)
    )).all()
    return {name: int(total or 0) for name, total in rows}


async def all_time(db: AsyncSession, name: str) -> int:
    return int(await db.scalar(
        select(func.coalesce(func.sum(SiteCounter.count), 0)).where(SiteCounter.name == name)) or 0)
