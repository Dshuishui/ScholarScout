"""
Redis-backed cache for search results.

Falls back gracefully to a no-op when REDIS_URL is not configured,
so the app works without Redis in local development.
"""
import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_redis = None
_init_attempted = False

REDIS_URL = os.environ.get("REDIS_URL", "")
SEARCH_TTL = int(os.environ.get("CACHE_SEARCH_TTL", "3600"))  # 1 hour


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


async def get_cached_search(
    keywords: list[str],
    sources: list[str],
    date_from: str = "",
    date_to: str = "",
) -> Optional[list[dict]]:
    """Return cached search results, or None on cache miss / Redis unavailable."""
    r = _get_redis()
    if r is None:
        return None
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
    """Store search results in Redis with TTL."""
    r = _get_redis()
    if r is None:
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
        return
    try:
        await r.delete(_cache_key(keywords, sources, date_from, date_to))
    except Exception as e:
        logger.warning("Cache invalidate failed (non-fatal): %s", e)
