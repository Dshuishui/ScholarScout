import json
import logging
import re
import asyncio
import urllib.parse
from openai import AsyncOpenAI
from models import Paper
from config import KIMI_BASE_URL, KIMI_MODEL

logger = logging.getLogger(__name__)

# 备用查找平台（规则拼接，无需 AI）
_PLATFORMS = [
    ("arXiv 预印本",      lambda doi, t: f"https://arxiv.org/search/?searchtype=all&query={urllib.parse.quote(t)}"),
    ("Sci-Hub",          lambda doi, t: f"https://sci-hub.se/{doi}" if doi else None),
    ("ResearchGate",     lambda doi, t: f"https://www.researchgate.net/search?q={urllib.parse.quote(t)}"),
    ("Semantic Scholar", lambda doi, t: f"https://www.semanticscholar.org/search?q={urllib.parse.quote(t)}"),
    ("Google Scholar",   lambda doi, t: f"https://scholar.google.com/scholar?q={urllib.parse.quote(t)}"),
    ("CORE",             lambda doi, t: f"https://core.ac.uk/search?q={urllib.parse.quote(t)}"),
    ("BASE",             lambda doi, t: f"https://www.base-search.net/Search/Results?q={urllib.parse.quote(t)}"),
    ("Open Access Button", lambda doi, t: f"https://openaccessbutton.org/access?doi={urllib.parse.quote(doi)}" if doi else None),
]


def generate_fallback_links(paper: Paper) -> list[dict]:
    """为无 PDF 论文生成各平台跳转链接，让用户用自己的机构资源查找。"""
    links = []
    for name, fn in _PLATFORMS:
        url = fn(paper.doi, paper.title[:120])
        if url:
            links.append({"name": name, "url": url})
    return links


async def find_pdfs_with_kimi(papers: list[Paper], kimi_key: str) -> dict[str, str]:
    """一次 Kimi 联网搜索，批量为无 PDF 论文查找开放获取链接。
    返回 {paper_id: pdf_url} 仅包含找到的条目。
    """
    if not papers or not kimi_key:
        return {}

    batch = papers[:15]  # 单次最多 15 篇，避免超长上下文
    paper_list = "\n".join(
        f"[{p.paper_id}] 《{p.title[:100]}》 DOI:{p.doi or 'N/A'} 来源:{p.source}"
        for p in batch
    )

    prompt = f"""请通过网络搜索，为以下每篇学术论文找到可直接下载的 PDF 链接。
只接受合法开放获取来源：arXiv、PubMed Central、机构开放库、作者个人主页等。
对找不到的论文填 null，不要编造链接。

{paper_list}

严格按以下 JSON 格式返回（不要任何其他文字）：
[{{"paper_id": "id值", "pdf_url": "直链或null"}}]"""

    client = AsyncOpenAI(api_key=kimi_key, base_url=KIMI_BASE_URL)
    messages: list[dict] = [{"role": "user", "content": prompt}]
    tools = [{"type": "builtin_function", "function": {"name": "$web_search"}}]

    try:
        for _ in range(8):  # 最多 8 轮对话处理工具调用
            response = await asyncio.wait_for(
                client.chat.completions.create(
                    model=KIMI_MODEL,
                    messages=messages,
                    tools=tools,
                    temperature=0.1,
                ),
                timeout=60.0,
            )
            choice = response.choices[0]

            # 将 assistant 消息加入历史（序列化 tool_calls）
            assistant_msg: dict = {"role": "assistant", "content": choice.message.content}
            if choice.message.tool_calls:
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in choice.message.tool_calls
                ]
            messages.append(assistant_msg)

            if choice.finish_reason == "tool_calls":
                # 将工具调用结果追加（Kimi 内置函数结果在 arguments 里）
                for tc in choice.message.tool_calls:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": tc.function.arguments or "",
                    })
                continue

            if choice.finish_reason == "stop":
                content = choice.message.content or ""
                match = re.search(r'\[.*?\]', content, re.DOTALL)
                if not match:
                    logger.warning("Kimi response has no JSON array: %s", content[:200])
                    return {}
                data = json.loads(match.group())
                return {
                    item["paper_id"]: item["pdf_url"]
                    for item in data
                    if isinstance(item, dict) and item.get("pdf_url")
                }
            break  # 其他 finish_reason 退出

    except asyncio.TimeoutError:
        logger.warning("Kimi PDF search timed out")
    except Exception as e:
        logger.warning("Kimi PDF search error: %s", e)

    return {}
