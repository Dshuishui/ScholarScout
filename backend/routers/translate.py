"""论文标题翻译：中文用户扫 50 条英文标题很累，这里提供一键中文标题。

用系统 Key，成本很低（一次几十条标题只有几百 token），所以不占用户的免费额度；
靠"服务端缓存 + 每 IP 限流 + 全站每日上限"控制花费。
"""
import json
from collections import OrderedDict, defaultdict

import openai
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import config
from logging_config import get_logger
from services.rate_limit import rate_ok, client_ip

logger = get_logger(__name__)
router = APIRouter()

MAX_TITLES = 60
REQUESTS_PER_HOUR = 30
CACHE_MAX = 5000
_attempts: dict[str, list[float]] = defaultdict(list)
_cache: "OrderedDict[str, str]" = OrderedDict()
_site_attempts: dict[str, list[float]] = defaultdict(list)

PROMPT = (
    "把下面每条学术论文标题翻译成简洁准确的中文。保留公认的英文缩写（如 BERT、RAG、CRISPR）。"
    "只输出 JSON：{\"translations\": [{\"i\": 序号, \"zh\": \"中文标题\"}]}，序号与输入一一对应。\n\n"
)


class TitlesRequest(BaseModel):
    titles: list[str] = Field(min_length=1, max_length=MAX_TITLES)


def _cache_get(title: str) -> str | None:
    zh = _cache.get(title)
    if zh is not None:
        _cache.move_to_end(title)
    return zh


def _cache_set(title: str, zh: str) -> None:
    _cache[title] = zh
    _cache.move_to_end(title)
    while len(_cache) > CACHE_MAX:
        _cache.popitem(last=False)


@router.post("/titles")
async def translate_titles(request: TitlesRequest, http_request: Request):
    """返回 {原标题: 中文标题}，翻译不了的条目直接不返回。"""
    if not config.DEEPSEEK_SYSTEM_KEY:
        raise HTTPException(status_code=503, detail={"code": "unavailable", "message": "标题翻译暂不可用"})
    if not rate_ok(_attempts, client_ip(http_request), limit=REQUESTS_PER_HOUR, window_sec=3600):
        raise HTTPException(status_code=429, detail={"code": "rate_limited", "message": "翻译请求过于频繁，请稍后再试"})

    titles = [t.strip()[:300] for t in request.titles if t.strip()]
    out: dict[str, str] = {}
    todo: list[str] = []
    for t in titles:
        cached = _cache_get(t)
        if cached:
            out[t] = cached
        elif t not in todo:
            todo.append(t)

    if not todo:
        return {"translations": out}

    if not rate_ok(_site_attempts, "site", limit=config.TRANSLATE_DAILY_CAP, window_sec=86400):
        # 达到上限时把已缓存的结果照常返回，不报错
        logger.warning("Title translation daily cap reached")
        return {"translations": out, "capped": True}

    numbered = "\n".join(f"{i}. {t}" for i, t in enumerate(todo))
    try:
        client = openai.AsyncOpenAI(api_key=config.DEEPSEEK_SYSTEM_KEY, base_url=config.DEEPSEEK_BASE_URL)
        resp = await client.chat.completions.create(
            model=config.DEEPSEEK_MODEL,
            messages=[{"role": "user", "content": PROMPT + numbered}],
            response_format={"type": "json_object"},
            temperature=0,
        )
        data = json.loads(resp.choices[0].message.content)
        for item in data.get("translations", []):
            idx, zh = item.get("i"), (item.get("zh") or "").strip()
            if isinstance(idx, int) and 0 <= idx < len(todo) and zh:
                _cache_set(todo[idx], zh)
                out[todo[idx]] = zh
    except Exception as e:
        logger.warning("Title translation failed: %s", e)
        raise HTTPException(status_code=502, detail={"code": "failed", "message": "翻译失败，请稍后重试"})

    return {"translations": out}
