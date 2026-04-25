import json
from openai import AsyncOpenAI
from models import ParsedQuery, Paper
from config import DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

INTENT_PROMPT = """判断用户输入的意图。

搜索论文的例子：找2023年后RAG相关的论文、帮我搜transformer综述、有没有关于RAFT的最新研究
普通对话的例子：只有一篇吗、你好、帮我解释一下RAFT算法、谢谢、这篇论文讲的是什么

用户输入：{query}

返回 JSON（不要额外文字）：
{{"intent": "search"}}
或
{{"intent": "chat", "reply": "直接回答用户的话"}}"""

PARSE_PROMPT = """你是学术搜索助手。将用户的中文需求转为结构化搜索参数。

用户需求：{query}

返回 JSON（不要有任何额外文字）：
{{
  "keywords": ["英文关键词1", "英文关键词2"],
  "date_from": "YYYY-01-01 或 null",
  "date_to": "YYYY-12-31 或 null",
  "max_results": 30
}}

规则：
- keywords 必须是英文学术术语，2-4 个，从宽到窄排列
- 用户未提时间则 date_from/date_to 为 null
- "最近两年" 相对今天计算"""

VALIDATE_PROMPT = """用户的原始需求：{query}

以下是搜索到的论文，请判断每篇与用户需求的相关性，过滤掉不相关的。

{papers_text}

返回 JSON 数组（不要有额外文字）：
[
  {{"id": "paper_id", "relevant": true, "reason": "一句话说明"}},
  ...
]"""


async def classify_intent(user_query: str, api_key: str) -> dict:
    """返回 {"intent": "search"} 或 {"intent": "chat", "reply": "..."}"""
    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    response = await client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=[{"role": "user", "content": INTENT_PROMPT.format(query=user_query)}],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    return json.loads(response.choices[0].message.content)


async def parse_query(user_query: str, api_key: str) -> ParsedQuery:
    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    response = await client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=[{"role": "user", "content": PARSE_PROMPT.format(query=user_query)}],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    data = json.loads(response.choices[0].message.content)
    return ParsedQuery(**data)


async def validate_papers(papers: list[Paper], user_query: str, api_key: str) -> list[Paper]:
    if not papers:
        return []

    papers_text = "\n\n".join(
        f"ID: {p.paper_id}\n标题: {p.title}\n摘要: {(p.abstract or '')[:200]}"
        for p in papers
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
    # DeepSeek 可能返回 {"results": [...]} 或直接 [...]
    verdicts = raw if isinstance(raw, list) else raw.get("results", raw.get("papers", list(raw.values())[0] if raw else []))

    verdict_map = {v["id"]: v for v in verdicts if v.get("relevant")}

    result = []
    for p in papers:
        if p.paper_id in verdict_map:
            p.relevance_reason = verdict_map[p.paper_id].get("reason")
            result.append(p)
    return result
