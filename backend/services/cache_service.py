"""
搜索结果缓存：配置了 REDIS_URL 用 Redis，否则退化成进程内缓存。

同一个问题重复搜索时结果应当一致。大模型抽关键词本身有随机性，
命中缓存能让"刚才那次搜索"原样返回，而不是给出一份不一样的结果。
"""
import json
import time
from collections import OrderedDict
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_redis = None
_init_attempted = False

REDIS_URL = os.environ.get("REDIS_URL", "")
# 6 小时：和关键词解析的缓存对齐，同一天里重复搜同一个问题结果保持一致。
# 论文数据不会分钟级变化，缓存久一点不影响结果质量。
SEARCH_TTL = int(os.environ.get("CACHE_SEARCH_TTL", "21600"))


def _get_redis():
    global _redis, _init_attempted
    if _init_attempted:
        return _redis
    _init_attempted = True

    if not REDIS_URL:
        logger.info("REDIS_URL not set — search caching disabled")
        return None

    try:
        import redis.asyncio as aioredis
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
        logger.info("Redis cache connected: %s", REDIS_URL.split("@")[-1])
    except Exception as e:
        logger.warning("Redis init failed (non-fatal): %s", e)
    return _redis


def _cache_key(keywords: list[str], sources: list[str], date_from: str, date_to: str) -> str:
    kw = ",".join(sorted(k.lower() for k in keywords))
    src = ",".join(sorted(sources))
    return f"search:{kw}:{src}:{date_from or ''}:{date_to or ''}"


# 没配 Redis 时退化成进程内缓存：同样的关键词短时间内重复搜索，结果保持一致，
# 也省掉一次外部 API 调用。进程重启即清空，容量有限，只做"同一个人连着搜两次"这种场景。
_MEMORY_CACHE_MAX = 64
_memory_cache: "OrderedDict[str, tuple[float, list[dict]]]" = OrderedDict()


def _memory_get(key: str) -> Optional[list[dict]]:
    item = _memory_cache.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at < time.time():
        _memory_cache.pop(key, None)
        return None
    _memory_cache.move_to_end(key)
    return value


def _memory_set(key: str, value: list[dict], ttl: int) -> None:
    _memory_cache[key] = (time.time() + ttl, value)
    _memory_cache.move_to_end(key)
    while len(_memory_cache) > _MEMORY_CACHE_MAX:
        _memory_cache.popitem(last=False)


async def get_cached_search(
    keywords: list[str],
    sources: list[str],
    date_from: str = "",
    date_to: str = "",
) -> Optional[list[dict]]:
    """Return cached search results, or None on cache miss."""
    r = _get_redis()
    if r is None:
        return _memory_get(_cache_key(keywords, sources, date_from, date_to))
    try:
        raw = await r.get(_cache_key(keywords, sources, date_from, date_to))
        if raw:
            logger.debug("Cache hit for keywords=%s", keywords)
            return json.loads(raw)
    except Exception as e:
        logger.warning("Cache get failed (non-fatal): %s", e)
    return None


async def cache_search(
    keywords: list[str],
    sources: list[str],
    results: list[dict],
    date_from: str = "",
    date_to: str = "",
    ttl: int = SEARCH_TTL,
) -> None:
    """Store search results (Redis when configured, otherwise in-process)."""
    r = _get_redis()
    if r is None:
        _memory_set(_cache_key(keywords, sources, date_from, date_to), results, ttl)
        return
    try:
        key = _cache_key(keywords, sources, date_from, date_to)
        await r.set(key, json.dumps(results, ensure_ascii=False), ex=ttl)
        logger.debug("Cached %d papers for keywords=%s (ttl=%ds)", len(results), keywords, ttl)
    except Exception as e:
        logger.warning("Cache set failed (non-fatal): %s", e)


async def invalidate_search(
    keywords: list[str],
    sources: list[str],
    date_from: str = "",
    date_to: str = "",
) -> None:
    """Remove a cached entry (e.g., after re-search)."""
    r = _get_redis()
    if r is None:
        _memory_cache.pop(_cache_key(keywords, sources, date_from, date_to), None)
        return
    try:
        await r.delete(_cache_key(keywords, sources, date_from, date_to))
    except Exception as e:
        logger.warning("Cache invalidate failed (non-fatal): %s", e)
