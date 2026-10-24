"""首屏结果之后再补一批论文，都要经 AI 筛选。网页搜索和 MCP 服务共用。
- 沿引用链：从高分论文出发找候选（search_service.expand_citations）
- 换个说法：结果太少时让大模型换一组检索词再搜一次
"""
import asyncio

from models import ParsedQuery, Paper
from services.llm_service import rank_accepted, suggest_requery, validate_papers
from services.pdf_finder_service import generate_fallback_links
from services.search_service import (
    EXPANSION_MIN_SCORE, enhance_with_unpaywall, expand_citations, only_new, search_all_sources,
)

# 8 分以上的论文少于这么多篇，就换个说法再搜一次。不能数 5 分以上的：窄题常有三四十篇 5 分，8 分以上却只有零到三篇
FEW_STRONG = 10


def strong_count(papers: list[Paper]) -> int:
    return sum((p.relevance_score or 0) >= EXPANSION_MIN_SCORE for p in papers)


async def expand_and_validate(final: list[Paper], pool: list[Paper], parsed: ParsedQuery,
                              query: str, api_key: str) -> list[Paper]:
    """沿引用链补：从 AI 打了高分的论文出发。"""
    seeds = [p for p in final if (p.relevance_score or 0) >= EXPANSION_MIN_SCORE]
    return await _vet(await expand_citations(seeds, pool, parsed), query, api_key, "citations")


async def requery_and_validate(query: str, parsed: ParsedQuery, pool: list[Paper], found: int, api_key: str,
                               limit_per_source: int, sources: list[str] | None = None) -> list[Paper]:
    """结果太少时换一组检索词再搜，返回经 AI 打过分、之前没有的论文。"""
    alt = await suggest_requery(query, parsed, found, api_key)
    if alt is None:
        return []
    candidates = only_new(await search_all_sources(alt, limit_per_source=limit_per_source, sources=sources), pool)
    return await _vet(candidates, query, api_key, "requery")


async def _vet(candidates: list[Paper], query: str, api_key: str, found_via: str) -> list[Paper]:
    """经 AI 筛选，返回打过分的。打分失败的不补：宁可少，不能混进没把关的论文。"""
    if not candidates:
        return []
    (accepted, _), enhanced = await asyncio.gather(
        validate_papers(candidates, query, api_key),
        enhance_with_unpaywall(candidates),
    )
    pdf_map = {p.paper_id: p.pdf_url for p in enhanced if p.pdf_url}
    more = []
    for p in rank_accepted(accepted):
        if p.relevance_score is None:
            continue
        pdf_url = p.pdf_url or pdf_map.get(p.paper_id)
        more.append(p.model_copy(update={
            "pdf_url": pdf_url,
            "fallback_links": [] if pdf_url else generate_fallback_links(p),
            "found_via": found_via,
        }))
    return more
