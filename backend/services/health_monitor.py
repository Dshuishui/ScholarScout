"""数据源健康监控 + 站长告警。

背景：每个数据源出错时都 `except → return []`，所以"整个搜索坏了"表现为静默的 0 结果。
2026-08 服务器代理失效后，全站搜索和订阅推送停了三周都没人发现。这里统计每个源最近的返回情况，
由定时任务每小时检查一次：
  - 某个源在上一个时间窗有结果、这个时间窗调用多次却一篇都没有 → 告警（状态变化才告警，
    arXiv 这种一直被限流的源不会天天发邮件）
  - 所有源最近多次调用合计一篇都没有 → 告警（代理失效这类全局故障）
  - 启用中的订阅超过 3 天没推送 → 告警
同一问题每天最多发一封邮件。统计只在内存里，重启后清空，足够发现持续性故障。
"""
import logging
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

WINDOW_SEC = 6 * 3600          # 统计窗口
MIN_CALLS = 5                  # 窗口内至少调用这么多次才下结论，避免偶发
STALLED_SUB_DAYS = 3
ALERT_COOLDOWN_SEC = 24 * 3600

# 源名 → deque[(时间戳, 返回篇数)]，保留最近两个窗口
_calls: dict[str, deque] = defaultdict(lambda: deque(maxlen=2000))
_last_alert: dict[str, float] = {}


def record_source_result(source: str, count: int) -> None:
    _calls[source].append((time.time(), count))


def _window_stats(source: str, start: float, end: float) -> tuple[int, int]:
    """返回 (调用次数, 有结果的次数)。"""
    hits = [(t, c) for t, c in _calls.get(source, ()) if start <= t < end]
    return len(hits), sum(1 for _, c in hits if c > 0)


def source_stats(now: float | None = None) -> dict[str, dict]:
    now = now or time.time()
    stats = {}
    for source in sorted(_calls):
        calls, nonzero = _window_stats(source, now - WINDOW_SEC, now + 1)
        last_ok = max((t for t, c in _calls[source] if c > 0), default=None)
        stats[source] = {
            "calls_6h": calls,
            "nonzero_6h": nonzero,
            "last_result_at": datetime.utcfromtimestamp(last_ok).isoformat() + "Z" if last_ok else None,
        }
    return stats


def detect_problems(now: float | None = None) -> list[tuple[str, str]]:
    """返回 [(问题 key, 描述)]。纯函数（只读内存统计），便于测试。"""
    now = now or time.time()
    problems: list[tuple[str, str]] = []
    total_calls = total_nonzero = 0
    for source in sorted(_calls):
        calls, nonzero = _window_stats(source, now - WINDOW_SEC, now + 1)
        prev_calls, prev_nonzero = _window_stats(source, now - 2 * WINDOW_SEC, now - WINDOW_SEC)
        total_calls += calls
        total_nonzero += nonzero
        if calls >= MIN_CALLS and nonzero == 0 and prev_nonzero > 0:
            problems.append((f"source:{source}",
                             f"数据源 {source} 最近 6 小时调用 {calls} 次全部返回 0 篇（之前 6 小时有 {prev_nonzero} 次有结果）"))
    if total_calls >= MIN_CALLS * 2 and total_nonzero == 0:
        problems.append(("all-sources",
                         f"所有数据源最近 6 小时共调用 {total_calls} 次，全部返回 0 篇：搜索功能可能整体失效（网络/代理？）"))
    return problems


async def stalled_subscriptions(db) -> list[tuple[int, str | None]]:
    """启用中、但超过 STALLED_SUB_DAYS 天没有成功推送的订阅 [(id, last_sent)]。刚创建的不算。"""
    from sqlalchemy import select, or_, and_
    from models_db import Subscription
    cutoff = datetime.utcnow() - timedelta(days=STALLED_SUB_DAYS)
    rows = (await db.execute(
        select(Subscription.id, Subscription.last_sent).where(
            Subscription.active == True,  # noqa: E712
            Subscription.created_at < cutoff,
            or_(Subscription.last_sent.is_(None), and_(Subscription.last_sent < cutoff)),
        )
    )).all()
    return [(r.id, r.last_sent.isoformat() if r.last_sent else None) for r in rows]


def _should_alert(key: str, now: float) -> bool:
    last = _last_alert.get(key)
    if last and now - last < ALERT_COOLDOWN_SEC:
        return False
    _last_alert[key] = now
    return True


async def run_health_check() -> list[str]:
    """定时任务入口：检查并发送告警邮件，返回本次发出的告警描述。"""
    from database import AsyncSessionLocal
    from services.email_service import send_admin_alert

    now = time.time()
    problems = detect_problems(now)
    try:
        async with AsyncSessionLocal() as db:
            stalled = await stalled_subscriptions(db)
    except Exception:
        logger.exception("Health check: failed to query subscriptions")
        stalled = []
    if stalled:
        ids = ", ".join(str(i) for i, _ in stalled)
        problems.append(("stalled-subscriptions",
                         f"{len(stalled)} 个启用中的订阅超过 {STALLED_SUB_DAYS} 天没有推送（订阅 id：{ids}）"))

    sent = []
    for key, message in problems:
        logger.warning("Health check problem: %s", message)
        if _should_alert(key, now):
            await send_admin_alert(message)
            sent.append(message)
    return sent
