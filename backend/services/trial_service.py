"""未登录访客的免费体验额度。

规则（config 可调）：
- 每个浏览器（前端在 localStorage 生成的随机设备标识）共 ANON_TRIAL_SEARCHES 次；
- 同一 IP 24 小时内最多 ANON_TRIAL_PER_IP_DAY 次，防止换浏览器、开无痕窗口反复领；
- 全站 24 小时内最多 ANON_TRIAL_DAILY_CAP 次，给系统 Key 的花费封顶。

设备标识和 IP 只存加盐摘要，用于计数，不能还原；超过 RETENTION_DAYS 天的记录定时删除。
"""
import asyncio
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

import config
from logging_config import get_logger
from models_db import TrialUsage

logger = get_logger(__name__)

RETENTION_DAYS = 90
_DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9-]{16,64}$")
# 单进程部署：用一把锁把"查次数 + 记一次"变成原子操作，避免并发请求多扣出额度
_reserve_lock = asyncio.Lock()


@dataclass
class AnonStatus:
    remaining: int          # 这个访客还能用几次（已按设备和 IP 两个维度取较小值）
    capacity_ok: bool       # 全站今日名额是否还有


def valid_device_id(device_id: Optional[str]) -> bool:
    return bool(device_id) and bool(_DEVICE_ID_RE.match(device_id))


def _digest(kind: str, value: str) -> str:
    return hashlib.sha256(f"{config.JWT_SECRET}:{kind}:{value}".encode()).hexdigest()


async def anon_status(db: AsyncSession, device_id: str, ip: str, now: Optional[datetime] = None) -> AnonStatus:
    now = now or datetime.utcnow()
    since = now - timedelta(days=1)
    device_used = await db.scalar(
        select(func.count()).select_from(TrialUsage).where(TrialUsage.device_hash == _digest("device", device_id))
    )
    ip_used_today = await db.scalar(
        select(func.count()).select_from(TrialUsage).where(
            TrialUsage.ip_hash == _digest("ip", ip), TrialUsage.created_at >= since,
        )
    )
    site_used_today = await db.scalar(
        select(func.count()).select_from(TrialUsage).where(TrialUsage.created_at >= since)
    )
    remaining = max(0, min(
        config.ANON_TRIAL_SEARCHES - (device_used or 0),
        config.ANON_TRIAL_PER_IP_DAY - (ip_used_today or 0),
    ))
    return AnonStatus(remaining=remaining, capacity_ok=(site_used_today or 0) < config.ANON_TRIAL_DAILY_CAP)


async def reserve_anon_search(db: AsyncSession, device_id: str, ip: str) -> tuple[Optional[int], AnonStatus]:
    """检查额度并记一次使用。有额度时返回 (记录 id, 扣减前的状态)，没有时返回 (None, 状态)。"""
    async with _reserve_lock:
        status = await anon_status(db, device_id, ip)
        if status.remaining <= 0 or not status.capacity_ok:
            return None, status
        row = TrialUsage(device_hash=_digest("device", device_id), ip_hash=_digest("ip", ip))
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return row.id, status


async def refund_anon_search(db: AsyncSession, usage_id: int) -> None:
    """搜索失败或没有结果时退还这次额度。"""
    await db.execute(delete(TrialUsage).where(TrialUsage.id == usage_id))
    await db.commit()


async def purge_old_usage(db: AsyncSession, now: Optional[datetime] = None) -> int:
    cutoff = (now or datetime.utcnow()) - timedelta(days=RETENTION_DAYS)
    result = await db.execute(delete(TrialUsage).where(TrialUsage.created_at < cutoff))
    await db.commit()
    return result.rowcount or 0


async def run_purge() -> None:
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        n = await purge_old_usage(db)
    if n:
        logger.info("Purged %d trial usage rows older than %d days", n, RETENTION_DAYS)
