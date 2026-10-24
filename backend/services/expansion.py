"""沿引用链补论文：从高分论文出发找候选（search_service.expand_citations），再经 AI 筛选。网页搜索和 MCP 服务共用。"""
import asyncio

from models import ParsedQuery, Paper
from services.llm_service import rank_accepted, validate_papers
from services.pdf_finder_service import generate_fallback_links
from services.search_service import EXPANSION_MIN_SCORE, enhance_with_unpaywall, expand_citations


async def expand_and_validate(final: list[Paper], pool: list[Paper], parsed: ParsedQuery,
                              query: str, api_key: str) -> list[Paper]:
    """返回经 AI 打过分的新论文。打分失败的不补：宁可少，不能混进没把关的论文。"""
    seeds = [p for p in final if (p.relevance_score or 0) >= EXPANSION_MIN_SCORE]
    candidates = await expand_citations(seeds, pool, parsed)
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
        }))
    return more
