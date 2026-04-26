import json
import asyncio
from openai import AsyncOpenAI
from models import ParsedQuery, Paper
from config import DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

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
  "keywords": ["英文关键词1", "英文关键词2"],
  "date_from": "YYYY-01-01 或 null",
  "date_to": "YYYY-12-31 或 null",
  "max_results": 30
}

规则：
- keywords 必须是英文学术术语，2-4 个，从宽到窄排列
- 用户未提时间则 date_from/date_to 为 null
- "最近两年" 相对今天计算
- 若用户说"找更多"或"换个方向"，结合历史推断搜索主题"""

VALIDATE_PROMPT = """用户的原始需求：{query}

以下是搜索到的论文，请判断每篇与用户需求的相关性，过滤掉不相关的。

{papers_text}

返回 JSON 数组（不要有额外文字）：
[
  {{"id": "paper_id", "relevant": true, "reason": "一句话说明"}},
  ...
]"""


async def classify_intent(user_query: str, api_key: str, history: list[dict] = []) -> dict:
    """返回 {"intent": "search"} 或 {"intent": "chat", "reply": "..."}"""
    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    messages = (
        [{"role": "system", "content": INTENT_SYSTEM}]
        + history[-8:]
        + [{"role": "user", "content": user_query}]
    )
    response = await client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=messages,
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    return json.loads(response.choices[0].message.content)


async def parse_query(user_query: str, api_key: str, history: list[dict] = []) -> ParsedQuery:
    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    messages = (
        [{"role": "system", "content": PARSE_SYSTEM}]
        + history[-8:]
        + [{"role": "user", "content": user_query}]
    )
    response = await client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=messages,
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    data = json.loads(response.choices[0].message.content)
    return ParsedQuery(**data)


async def validate_papers(
    papers: list[Paper], user_query: str, api_key: str
) -> tuple[list[Paper], list[Paper]]:
    """返回 (accepted, rejected) 两个列表。"""
    if not papers:
        return [], []

    BATCH_SIZE = 20

    async def _validate_batch(batch: list[Paper]) -> tuple[list[Paper], list[Paper]]:
        papers_text = "\n\n".join(
            f"ID: {p.paper_id}\n标题: {p.title}\n摘要: {(p.abstract or '')[:200]}"
            for p in batch
        )
        client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
        response = await client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[{"role": "user", "content": VALIDATE_PROMPT.format(
                query=user_query, papers_text=papers_text
            )}],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        raw = json.loads(response.choices[0].message.content)
        verdicts = raw if isinstance(raw, list) else raw.get("results", raw.get("papers", list(raw.values())[0] if raw else []))
        verdict_map = {v["id"]: v for v in verdicts}
        accepted, rejected = [], []
        for p in batch:
            v = verdict_map.get(p.paper_id)
            if v and v.get("relevant"):
                p.relevance_reason = v.get("reason")
                accepted.append(p)
            else:
                rejected.append(p)
        return accepted, rejected

    batches = [papers[i:i + BATCH_SIZE] for i in range(0, len(papers), BATCH_SIZE)]
    batch_results = await asyncio.gather(*[_validate_batch(b) for b in batches], return_exceptions=True)

    accepted: list[Paper] = []
    rejected: list[Paper] = []
    for r in batch_results:
        if not isinstance(r, Exception):
            a, rej = r
            accepted.extend(a)
            rejected.extend(rej)
    return accepted, rejected
