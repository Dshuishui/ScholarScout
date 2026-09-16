import json
from collections import OrderedDict
import time
import asyncio
import logging
import math
from openai import AsyncOpenAI
from models import ParsedQuery, Paper
from config import DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

logger = logging.getLogger(__name__)

INTENT_SYSTEM = """你是学术论文搜索助手。结合对话历史判断用户最新输入的意图。

搜索意图示例：找2023年后RAG相关的论文、帮我再搜、找更多、找这个领域2022年的、换个关键词搜
对话意图示例：只有一篇吗、你好、帮我解释一下这篇、谢谢、这是什么意思、第一篇讲的是什么

返回 JSON（不要额外文字）：
{"intent": "search"}
或
{"intent": "chat", "reply": "结合上下文直接回答用户"}"""

PARSE_SYSTEM = """你是学术搜索助手。结合对话历史，将用户的最新需求转为结构化搜索参数。

返回 JSON（不要有任何额外文字）：
{
  "keywords": ["英文关键词1", "英文关键词2", "同义词或相关术语3", "更宽泛的上位概念4"],
  "date_from": "YYYY-01-01 或 null",
  "date_to": "YYYY-12-31 或 null",
  "max_results": 30,
  "domains": ["cs"]
}

规则：
- keywords 必须是英文学术术语，3-6 个，涵盖：核心概念、常见同义词、相关子领域、上位概念
  例如用户说"transformer"→ ["transformer", "attention mechanism", "self-attention", "large language model"]
  例如用户说"癌症检测"→ ["cancer detection", "tumor diagnosis", "oncology screening", "malignancy classification"]
- 保证关键词多样性，避免完全重复的词
- domains 是需求涉及的学科，只能从这些值里选：cs（计算机/人工智能/软件）、math、physics、astro（天文/地球科学）、bio（生物/生命科学）、med（医学/药学/公共卫生）、chem（化学/材料）、eng（工程）、social（经济/心理/教育/社会学）、humanities
  交叉学科要把涉及的学科都列上，例如"深度学习用于医学影像" → ["cs", "med"]；拿不准时返回 []
- 用户未提时间则 date_from/date_to 为 null
- "最近两年" 相对今天计算
- 若用户说"找更多"或"换个方向"，结合历史推断搜索主题"""

VALIDATE_PROMPT = """用户的原始需求：{query}

以下是搜索到的论文，请对每篇进行评估：
1. score（0-10）：与用户需求的相关性评分，0=完全无关，10=完全切题
2. reason：一句话说明相关或不相关的原因
3. tldr：针对用户需求，一句话概括这篇论文的核心贡献或发现（中文，≤30字）

{papers_text}

返回 JSON 数组（不要有额外文字）：
[
  {{"id": "paper_id", "score": 8, "reason": "一句话说明", "tldr": "核心发现一句话"}},
  ...
]"""


_REASONING_MODELS = {"deepseek-reasoner"}


# 同一个问题要给出同样的结果：temperature 0.1 时抽出来的关键词每次都有出入
# （实测同一句话解析三次，6 个关键词里有 2~3 个不同，连带识别出的学科也不同，
# 于是搜的数据源、拿到的候选池、最终结果都不一样）。
TEMPERATURE = 0

# 即便 temperature=0，大模型也不保证每次逐字相同。同一句话在短时间内重复搜索时，
# 直接复用上次解析出的关键词，保证"同样的问题给同样的结果"。带上下文的追问不缓存。
_PARSE_CACHE_TTL = 6 * 3600
_PARSE_CACHE_MAX = 256
_parse_cache: "OrderedDict[tuple[str, str], tuple[float, ParsedQuery]]" = OrderedDict()


def _parse_cache_get(key: tuple[str, str]) -> ParsedQuery | None:
    item = _parse_cache.get(key)
    if not item:
        return None
    expires_at, parsed = item
    if expires_at < time.time():
        _parse_cache.pop(key, None)
        return None
    _parse_cache.move_to_end(key)
    return parsed.model_copy(deep=True)


def _parse_cache_set(key: tuple[str, str], parsed: ParsedQuery) -> None:
    _parse_cache[key] = (time.time() + _PARSE_CACHE_TTL, parsed.model_copy(deep=True))
    _parse_cache.move_to_end(key)
    while len(_parse_cache) > _PARSE_CACHE_MAX:
        _parse_cache.popitem(last=False)


def _json_model(model: str) -> str:
    """deepseek-reasoner 不支持 json_object 格式，降级到默认模型。"""
    return DEEPSEEK_MODEL if model in _REASONING_MODELS else model


async def classify_intent(user_query: str, api_key: str, history: list[dict] = [], model: str = DEEPSEEK_MODEL) -> dict:
    """返回 {"intent": "search"} 或 {"intent": "chat", "reply": "..."}"""
    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    messages = (
        [{"role": "system", "content": INTENT_SYSTEM}]
        + history[-8:]
        + [{"role": "user", "content": user_query}]
    )
    response = await client.chat.completions.create(
        model=_json_model(model),
        messages=messages,
        response_format={"type": "json_object"},
        temperature=TEMPERATURE,
    )
    return json.loads(response.choices[0].message.content)


async def parse_query(user_query: str, api_key: str, history: list[dict] = [], model: str = DEEPSEEK_MODEL) -> ParsedQuery:
    cache_key = (user_query.strip(), model)
    if not history:
        cached = _parse_cache_get(cache_key)
        if cached is not None:
            return cached
    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    messages = (
        [{"role": "system", "content": PARSE_SYSTEM}]
        + history[-8:]
        + [{"role": "user", "content": user_query}]
    )
    response = await client.chat.completions.create(
        model=_json_model(model),
        messages=messages,
        response_format={"type": "json_object"},
        temperature=TEMPERATURE,
    )
    data = json.loads(response.choices[0].message.content)
    # 用户没说时间就不限年份：以前默认只搜近 5 年，Transformer、ResNet 这类奠基论文会被直接排除
    parsed = ParsedQuery(**data)
    if not history:
        _parse_cache_set(cache_key, parsed)
    return parsed


async def validate_papers(
    papers: list[Paper], user_query: str, api_key: str, model: str = DEEPSEEK_MODEL
) -> tuple[list[Paper], list[Paper]]:
    """返回 (accepted, rejected) 两个列表。"""
    if not papers:
        return [], []

    BATCH_SIZE = 20

    async def _validate_batch(batch: list[Paper]) -> tuple[list[Paper], list[Paper]]:
        papers_text = "\n\n".join(
            f"ID: {p.paper_id}\n标题: {p.title}\n摘要: {p.abstract or '（无摘要）'}"
            for p in batch
        )
        client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
        response = await client.chat.completions.create(
            model=_json_model(model),
            messages=[{"role": "user", "content": VALIDATE_PROMPT.format(
                query=user_query, papers_text=papers_text
            )}],
            response_format={"type": "json_object"},
            temperature=TEMPERATURE,
        )
        raw = json.loads(response.choices[0].message.content)
        verdicts = raw if isinstance(raw, list) else raw.get("results", raw.get("papers", list(raw.values())[0] if raw else []))
        verdict_map = {v["id"]: v for v in verdicts}
        accepted, rejected = [], []
        for p in batch:
            v = verdict_map.get(p.paper_id)
            score = float(v.get("score", 0)) if v else 0
            if v and score >= 5:
                p.relevance_reason = v.get("reason")
                p.relevance_score = score
                p.tldr = v.get("tldr")
                accepted.append(p)
            else:
                rejected.append(p)
        return accepted, rejected

    async def _validate_batch_with_retry(batch: list[Paper]) -> tuple[list[Paper], list[Paper]]:
        try:
            return await _validate_batch(batch)
        except Exception as first_error:
            try:
                return await _validate_batch(batch)
            except Exception:
                # 重试仍失败：这批论文不打分直接保留，而不是整批悄悄消失
                logger.warning("Validation batch of %d failed twice, keeping unscored: %s", len(batch), first_error)
                return list(batch), []

    batches = [papers[i:i + BATCH_SIZE] for i in range(0, len(papers), BATCH_SIZE)]
    batch_results = await asyncio.gather(*[_validate_batch_with_retry(b) for b in batches])

    accepted: list[Paper] = []
    rejected: list[Paper] = []
    for a, rej in batch_results:
        accepted.extend(a)
        rejected.extend(rej)
    return accepted, rejected


def citation_bonus(citations: int) -> float:
    """引用量加分，0～1 分：100 次 ≈ 0.5，1 万次及以上 = 1。

    大模型评分基本是 5～10 的整数，同分很多；参考 Semantic Scholar、Consensus 的做法，
    用引用量把奠基论文排到同分论文前面。封顶 1 分，不会压过明显更高的相关性判断。
    """
    return min(1.0, math.log10(1 + max(citations, 0)) / 4)


def rank_accepted(papers: list[Paper]) -> list[Paper]:
    """按"大模型相关性评分 + 引用量加分"从高到低排序；没打分的排最后。

    必须在截取 validated_limit 之前调用，否则排在后面的数据源里的高分论文会先被截掉。
    """
    def key(p: Paper) -> float:
        if p.relevance_score is None:
            return -1.0
        return p.relevance_score + citation_bonus(p.citations)
    return sorted(papers, key=key, reverse=True)
