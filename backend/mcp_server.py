"""把 ScholarScout 的检索流程做成 MCP 服务（stdio），给 Claude Code、Codex、Cursor 等智能体直接调用。

用法（在 backend/ 目录装好依赖后）：
    claude mcp add scholarscout -- uv run --directory /path/to/ScholarScout/backend python mcp_server.py

Key 从 backend/.env 或环境变量读取，都可以不配：
- OPENALEX_API_KEY：配置后启用语义检索、概念交集、按被引补经典论文和引用链扩展
- DEEPSEEK_API_KEY：配置后由 DeepSeek 给每篇论文打相关性分；不配时返回未筛选的候选，由调用方的模型自己判断

没有用官方 mcp SDK：它要求 uvicorn>=0.31，和后端锁定的版本冲突。stdio 传输就是按行收发 JSON-RPC 2.0，
这里实现了 initialize、ping、tools/list、tools/call，够客户端发现和调用工具。
"""
import asyncio
import json
import logging
import re
import sys

# stdout 只能写协议消息：任何库顺手 print 一行，客户端就会解析失败断开。真正的 stdout 留给协议，其余输出都改到 stderr
_PROTOCOL_OUT = sys.stdout
if __name__ == "__main__":
    sys.stdout = sys.stderr

import config  # noqa: E402
from models import Paper, ParsedQuery  # noqa: E402
from services.expansion import FEW_STRONG, expand_and_validate, requery_and_validate, strong_count  # noqa: E402
from services.llm_service import rank_accepted, validate_papers  # noqa: E402
from services.search_service import citation_neighbors, search_all_sources  # noqa: E402

logger = logging.getLogger("scholarscout.mcp")

SERVER_INFO = {"name": "scholarscout", "version": "0.1.0"}
PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
MAX_RESULTS = 50

INSTRUCTIONS = (
    "Academic paper search over OpenAlex, arXiv, Semantic Scholar, CrossRef, PubMed, Europe PMC and INSPIRE-HEP. "
    "Translate the user's need into English keywords yourself; for 'A applied to B' questions also pass concept groups. "
    "Results come with DOI/URL; cite only papers returned by the tools."
)

TOOLS = [
    {
        "name": "search_papers",
        "description": (
            "Search academic papers across several scholarly databases, merge duplicates, and (when the server has a "
            "DeepSeek key) score each paper's relevance to the question and follow citations of the best ones. "
            "Takes 20-90 seconds. Write keywords in English even if the user asked in another language."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "The user's research need in their own words; used to judge relevance."},
                "keywords": {
                    "type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 8,
                    "description": "3-6 English search terms: core concept first, then synonyms and broader terms.",
                },
                "concepts": {
                    "type": "array", "items": {"type": "array", "items": {"type": "string"}}, "maxItems": 3,
                    "description": (
                        "Optional. Concepts that must ALL appear, each as a list of English synonyms, e.g. "
                        "[[\"reinforcement learning\"], [\"missile guidance\", \"guidance law\"]]. Use one group for a single topic."
                    ),
                },
                "date_from": {"type": "string", "description": "Optional earliest publication date, YYYY-MM-DD. Omit unless the user asked for a time range."},
                "domains": {
                    "type": "array", "items": {"type": "string"},
                    "description": "Optional fields used to pick databases: cs, math, physics, astro, bio, med, chem, eng, social, humanities.",
                },
                "max_results": {"type": "integer", "minimum": 1, "maximum": MAX_RESULTS, "default": 20},
            },
            "required": ["question", "keywords"],
        },
    },
    {
        "name": "related_papers",
        "description": (
            "Given one paper (DOI or OpenAlex work ID like W2741809807), return the papers it cites (most cited first) "
            "and the papers citing it, via OpenAlex. Requires the server to have an OpenAlex key. Results are not relevance-scored."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "paper": {"type": "string", "description": "DOI (10.xxxx/...) or OpenAlex work ID (W...)."},
                "keywords": {
                    "type": "array", "items": {"type": "string"},
                    "description": "Optional English terms to rank the citing papers by topic; without them they are ranked by citations.",
                },
                "max_results": {"type": "integer", "minimum": 1, "maximum": MAX_RESULTS, "default": 20,
                                "description": "Per list: up to this many references and this many citing papers."},
            },
            "required": ["paper"],
        },
    },
]


def _paper_out(p: Paper, with_abstract: bool) -> dict:
    out = {
        "title": p.title,
        "authors": p.authors[:3] + (["et al."] if len(p.authors) > 3 else []),
        "year": (p.published_date or "")[:4] or None,
        "venue": p.venue,
        "doi": p.doi,
        "url": p.url,
        "pdf_url": p.pdf_url,
        "citations": p.citations,
        "source": p.source,
    }
    if p.relevance_score is not None:
        out["relevance_score"] = p.relevance_score
        out["reason"] = p.relevance_reason
    if p.found_via:
        out["found_via"] = p.found_via
    if with_abstract and p.abstract:
        out["abstract"] = p.abstract[:600]
    return {k: v for k, v in out.items() if v not in (None, "", [])}


def _limit(args: dict) -> int:
    try:
        return max(1, min(int(args.get("max_results") or 20), MAX_RESULTS))
    except (TypeError, ValueError):
        return 20


async def search_papers(args: dict) -> dict:
    keywords = [k for k in args.get("keywords") or [] if isinstance(k, str) and k.strip()]
    if not keywords:
        raise ValueError("keywords must be a non-empty list of English search terms")
    question = str(args.get("question") or " ".join(keywords))
    parsed = ParsedQuery(keywords=keywords, concepts=args.get("concepts") or [],
                         date_from=args.get("date_from") or None, domains=args.get("domains") or [])
    limit = _limit(args)
    pool = await search_all_sources(parsed, limit_per_source=config.SEARCH_LIMIT_PER_SOURCE)
    api_key = config.DEEPSEEK_API_KEY or config.DEEPSEEK_SYSTEM_KEY
    if not api_key:
        # 没法打分：按被引数给出候选并附上摘要，让调用方的模型自己判断
        pool.sort(key=lambda p: p.citations, reverse=True)
        return {"relevance_scored": False, "candidates_found": len(pool),
                "papers": [_paper_out(p, with_abstract=True) for p in pool[:limit]]}
    accepted, _ = await validate_papers(pool, question, api_key) if pool else ([], [])
    final = rank_accepted(accepted)
    extra = []
    if strong_count(final) < FEW_STRONG:  # 高度相关的太少就换一组检索词再搜一次
        extra = await requery_and_validate(question, parsed, pool, strong_count(final), api_key,
                                           config.SEARCH_LIMIT_PER_SOURCE)
    more = await expand_and_validate(final + extra, pool + extra, parsed, question, api_key)
    ranked = rank_accepted(final + extra + more)
    return {"relevance_scored": True, "candidates_found": len(pool), "relevant": len(ranked),
            "found_by_other_keywords": len(extra), "found_via_citations": len(more),
            "papers": [_paper_out(p, with_abstract=False) for p in ranked[:limit]]}


async def related_papers(args: dict) -> dict:
    ref = str(args.get("paper") or "").strip()
    ref = ref.removeprefix("https://openalex.org/").removeprefix("https://doi.org/")
    if not ref:
        raise ValueError("paper must be a DOI or an OpenAlex work ID")
    if not config.OPENALEX_API_KEY:
        raise ValueError("related_papers needs OPENALEX_API_KEY on the server")
    work_id = re.fullmatch(r"[Ww]\d+", ref)
    seed = Paper(paper_id=ref.upper() if work_id else f"doi:{ref}", doi=None if work_id else ref,
                 title=ref, authors=[], source="OpenAlex")
    keywords = [k for k in args.get("keywords") or [] if isinstance(k, str) and k.strip()]
    n = _limit(args)
    refs, citing = await citation_neighbors([seed], [seed], ParsedQuery(keywords=keywords), n, n)
    return {"references": [_paper_out(p, with_abstract=True) for p in refs],
            "cited_by": [_paper_out(p, with_abstract=True) for p in citing]}


HANDLERS = {"search_papers": search_papers, "related_papers": related_papers}


async def handle(msg: dict) -> dict | None:
    """处理一条 JSON-RPC 消息；通知（没有 id）返回 None。"""
    method, msg_id, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if msg_id is None:
        return None  # notifications/initialized、notifications/cancelled 等不用回
    if method == "initialize":
        requested = params.get("protocolVersion")
        result = {
            "protocolVersion": requested if requested in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": INSTRUCTIONS,
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        handler = HANDLERS.get(params.get("name"))
        if not handler:
            return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32602, "message": f"unknown tool: {params.get('name')}"}}
        try:
            data = await handler(params.get("arguments") or {})
            result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}], "isError": False}
        except Exception as e:  # 工具出错按 MCP 约定放在结果里，让模型看到原因，而不是协议错误
            logger.warning("tool %s failed: %s", params.get("name"), e)
            result = {"content": [{"type": "text", "text": f"Error: {e}"}], "isError": True}
    else:
        return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"method not found: {method}"}}
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


async def serve() -> None:
    write_lock = asyncio.Lock()
    pending: set[asyncio.Task] = set()

    async def respond(msg: dict) -> None:
        reply = await handle(msg)
        if reply is not None:
            async with write_lock:
                _PROTOCOL_OUT.write(json.dumps(reply, ensure_ascii=False) + "\n")
                _PROTOCOL_OUT.flush()

    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        # 搜索要几十秒，每条请求单独跑，期间仍能回 ping
        task = asyncio.create_task(respond(msg))
        pending.add(task)
        task.add_done_callback(pending.discard)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    asyncio.run(serve())
