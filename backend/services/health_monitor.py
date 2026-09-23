"""数据源健康监控 + 站长告警。

背景：每个数据源出错时都 `except → return []`，所以"整个搜索坏了"表现为静默的 0 结果。
2026-08 服务器代理失效后，全站搜索和订阅推送停了三周都没人发现。这里统计每个源最近的返回情况，
由定时任务每小时检查一次：
  - 某个源在上一个时间窗有结果、这个时间窗调用多次却一篇都没有 → 告警（状态变化才告警，
    arXiv 这种一直被限流的源不会天天发邮件）
  - 所有源最近多次调用合计一篇都没有 → 告警（代理失效这类全局故障）
  - 启用中的订阅超过 3 天没推送 → 告警
  - 未登录免费体验 24 小时内用到每日上限的 80% → 提醒（系统 Key 花费）
  - 数据库备份超过 36 小时没有成功 → 告警（备份悄悄失效比没有备份更危险）
  - DeepSeek 余额低于阈值 → 告警（余额耗尽后搜索筛选、免费对话、订阅解读全部失败）
  - 磁盘使用率超过阈值 → 告警（日志和备份会一直涨）
  - 一小时内错误日志突增 → 告警（功能坏了但没崩的情况）
  - 订阅推送邮件发送失败 → 告警
  - 第一次有真实用户完成搜索 → 通知（好消息也要知道）
同一问题每天最多发一封邮件。统计只在内存里，重启后清空，足够发现持续性故障。
"""
import json
import logging
import os
import time
from pathlib import Path
from collections import defaultdict, deque
from datetime import datetime, timedelta

import config

logger = logging.getLogger(__name__)

WINDOW_SEC = 6 * 3600          # 统计窗口
MIN_CALLS = 5                  # 窗口内至少调用这么多次才下结论，避免偶发
STALLED_SUB_DAYS = 3
ALERT_COOLDOWN_SEC = 24 * 3600
TRIAL_CAP_ALERT_RATIO = 0.8    # 未登录体验用到每日上限的 80% 就提醒

# 源名 → deque[(时间戳, 返回篇数)]，保留最近两个窗口
_calls: dict[str, deque] = defaultdict(lambda: deque(maxlen=2000))
_last_alert: dict[str, float] = {}
# 告警冷却时间落盘：只放内存的话每次重启后端（部署）都会清零，
# 同一个问题一天内会重复发邮件（2026-09-16 实际发生：部署重启后 7 小时内收到两封同样的告警）
ALERT_STATE_FILE = Path(__file__).resolve().parent.parent / ".alert_state.json"
_state_loaded = False


def _load_alert_state() -> None:
    global _state_loaded
    if _state_loaded:
        return
    _state_loaded = True
    try:
        data = json.loads(ALERT_STATE_FILE.read_text())
        _last_alert.update({k: float(v) for k, v in data.items()})
    except (FileNotFoundError, ValueError, OSError):
        pass


def _save_alert_state() -> None:
    try:
        ALERT_STATE_FILE.write_text(json.dumps(_last_alert))
    except OSError as e:
        logger.warning("Failed to persist alert state: %s", e)


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


async def trial_usage_last_day(db) -> int:
    from sqlalchemy import func, select
    from models_db import TrialUsage
    since = datetime.utcnow() - timedelta(days=1)
    return await db.scalar(select(func.count()).select_from(TrialUsage).where(TrialUsage.created_at >= since)) or 0


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


async def deepseek_balance() -> float | None:
    """查询系统 Key 的人民币余额；查不到返回 None（不因为查询失败而误报）。"""
    key = config.DEEPSEEK_SYSTEM_KEY or config.DEEPSEEK_API_KEY
    if not key:
        return None
    try:
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{config.DEEPSEEK_BASE_URL.rstrip('/')}/user/balance",
                                 headers={"Authorization": f"Bearer {key}"})
            r.raise_for_status()
            for info in r.json().get("balance_infos", []):
                if info.get("currency") == "CNY":
                    return float(info.get("total_balance"))
    except Exception as e:
        logger.info("DeepSeek balance query failed: %s", e)
    return None


def balance_problem(balance: float | None) -> tuple[str, str] | None:
    threshold = config.DEEPSEEK_BALANCE_ALERT_CNY
    if balance is None or balance >= threshold:
        return None
    return ("deepseek-balance",
            f"DeepSeek 账户余额仅剩 ¥{balance:.2f}（低于 ¥{threshold:.0f}）。余额用完后，搜索的 AI 筛选、"
            f"免费论文对话、订阅推送的论文解读都会失败，请尽快到 platform.deepseek.com 充值")


def disk_problem() -> tuple[str, str] | None:
    import shutil
    try:
        usage = shutil.disk_usage("/")
    except OSError:
        return None
    used_pct = 100 * usage.used / usage.total
    if used_pct < config.DISK_ALERT_PERCENT:
        return None
    free_gb = usage.free / 1024 ** 3
    return ("disk", f"服务器磁盘已用 {used_pct:.0f}%，剩余 {free_gb:.1f} GB。"
                    f"日志和数据库备份会继续增长，建议清理 /var/log 和旧备份")


def error_spike_problem(now: float) -> tuple[str, str] | None:
    """一小时内错误日志条数突增：功能坏了但进程没崩的情况，只看日志很难发现。"""
    from logging_config import recent_error_count
    count = recent_error_count(window_sec=3600)
    if count < config.ERROR_SPIKE_THRESHOLD:
        return None
    return ("error-spike", f"最近一小时后端记录了 {count} 条错误日志（阈值 {config.ERROR_SPIKE_THRESHOLD}），"
                           f"请查看：sudo journalctl -u scholarscout-backend -p err -n 100")


async def push_failure_problem(db) -> tuple[str, str] | None:
    from services import stats
    counters = await stats.totals(db, days=1)
    failed = counters.get(stats.PUSH_FAILED, 0)
    if not failed:
        return None
    return ("push-failed", f"过去一天有 {failed} 封订阅推送邮件发送失败。"
                           f"常见原因：SMTP 授权码失效、对方邮箱拒收")


def already_notified(key: str) -> bool:
    _load_alert_state()
    return key in _last_alert


async def first_real_user(db) -> tuple[str, str] | None:
    """第一次有人完成搜索时通知一次——这是最值得知道的好消息。

    通知过就不再检查：否则此后每小时都会记一条 warning，把日志刷满（实际发生过两天）。
    """
    if already_notified("first-user"):
        return None
    from services import stats
    total = await stats.all_time(db, stats.SEARCH)
    if total <= 0:
        return None
    return ("first-user", f"有人用了网站：累计已完成 {total} 次搜索。"
                          f"可以去看看留言板和统计，确认是不是真实用户")


def backup_problem(now: float) -> tuple[str, str] | None:
    """备份状态文件里是最后一次成功备份的 unix 时间戳，见 deploy/backup.sh。"""
    path = config.BACKUP_STATUS_FILE
    if not path:
        return None
    try:
        with open(path) as f:
            last = float(f.read().strip())
    except FileNotFoundError:
        return ("backup", f"数据库备份状态文件不存在（{path}），备份可能从未成功执行过")
    except (OSError, ValueError) as e:
        return ("backup", f"读取备份状态文件失败（{path}）：{e}")
    age_h = (now - last) / 3600
    if age_h > config.BACKUP_MAX_AGE_HOURS:
        return ("backup", f"数据库备份已经 {age_h:.0f} 小时没有成功（上次成功："
                          f"{datetime.fromtimestamp(last).strftime('%Y-%m-%d %H:%M')}），请检查 cron 和 deploy/backup.sh")
    return None


# 这类"好消息"只通知一次，不需要每天重复
ONCE_ONLY_KEYS = {"first-user"}


def _should_alert(key: str, now: float) -> bool:
    _load_alert_state()
    last = _last_alert.get(key)
    if last and key in ONCE_ONLY_KEYS:
        return False
    if last and now - last < ALERT_COOLDOWN_SEC:
        return False
    _last_alert[key] = now
    _save_alert_state()
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
    try:
        async with AsyncSessionLocal() as db:
            trial_used = await trial_usage_last_day(db)
    except Exception:
        logger.exception("Health check: failed to query trial usage")
        trial_used = 0
    backup = backup_problem(now)
    if backup:
        problems.append(backup)

    low_balance = balance_problem(await deepseek_balance())
    if low_balance:
        problems.append(low_balance)

    for check in (disk_problem(), error_spike_problem(now)):
        if check:
            problems.append(check)

    try:
        async with AsyncSessionLocal() as db:
            for check in (await push_failure_problem(db), await first_real_user(db)):
                if check:
                    problems.append(check)
    except Exception:
        logger.exception("Health check: failed to query counters")

    cap = config.ANON_TRIAL_DAILY_CAP
    if cap > 0 and trial_used >= cap * TRIAL_CAP_ALERT_RATIO:
        problems.append(("trial-cap",
                         f"过去 24 小时未登录免费体验已用 {trial_used}/{cap} 次，接近或达到每日上限，"
                         f"请留意系统 DeepSeek Key 的花费，必要时调整 ANON_TRIAL_DAILY_CAP"))

    sent = []
    for key, message in problems:
        logger.warning("Health check problem: %s", message)
        if _should_alert(key, now):
            await send_admin_alert(message)
            sent.append(message)
    return sent
