"""Semantic search and RAG endpoints."""
import asyncio
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from config import DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
from services.vector_service import semantic_search, find_similar, collection_count, compute_similarity_graph

from logging_config import get_logger
logger = get_logger(__name__)
router = APIRouter()


# ── Request models ────────────────────────────────────────────────────────────

class SemanticSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    n_results: int = Field(default=10, ge=1, le=50)


class SimilarRequest(BaseModel):
    paper_id: str = Field(min_length=1, max_length=200)
    n_results: int = Field(default=5, ge=1, le=20)


class RagPaper(BaseModel):
    paper_id: str
    title: str
    abstract: Optional[str] = None
    authors: Optional[list[str]] = None
    published_date: Optional[str] = None
    source: Optional[str] = None


class RagRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    papers: list[RagPaper] = Field(min_length=1, max_length=20)
    api_key: str = Field(min_length=1)
    model: str = DEEPSEEK_MODEL


class GraphPaper(BaseModel):
    paper_id: str
    title: str
    abstract: Optional[str] = None
    citations: int = 0
    source: Optional[str] = None
    published_date: Optional[str] = None
    authors: Optional[list[str]] = None


class GraphRequest(BaseModel):
    papers: list[GraphPaper] = Field(min_length=2, max_length=50)
    threshold: float = Field(default=0.35, ge=0.0, le=1.0)


# ── GET /api/semantic/status ──────────────────────────────────────────────────

@router.get("/status")
async def semantic_status():
    """Number of papers currently indexed."""
    return {"indexed_count": collection_count()}


# ── POST /api/semantic/search ─────────────────────────────────────────────────

@router.post("/search")
async def semantic_search_endpoint(req: SemanticSearchRequest):
    """Natural-language search across all indexed paper abstracts."""
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        None, lambda: semantic_search(req.query, req.n_results)
    )
    return {"results": results, "query": req.query}


# ── POST /api/semantic/similar ────────────────────────────────────────────────

@router.post("/similar")
async def similar_papers(req: SimilarRequest):
    """Find papers semantically similar to the given paper_id."""
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(
        None, lambda: find_similar(req.paper_id, req.n_results)
    )
    if not results:
        raise HTTPException(
            status_code=404,
            detail="该论文尚未被索引，请先在搜索结果中加载它。"
        )
    return {"results": results, "paper_id": req.paper_id}


# ── POST /api/semantic/rag ────────────────────────────────────────────────────

@router.post("/rag")
async def rag_query(req: RagRequest):
    """
    Multi-paper RAG: answer a question grounded in the provided paper abstracts.
    Streams the response.
    """
    context_parts = []
    for i, p in enumerate(req.papers, 1):
        authors = ", ".join(p.authors or [])[:100] if p.authors else "unknown"
        year = (p.published_date or "")[:4]
        abstract = (p.abstract or "（无摘要）")[:600]
        context_parts.append(
            f"[{i}] **{p.title}**\n"
            f"作者: {authors}{'  年份: ' + year if year else ''}\n"
            f"摘要: {abstract}"
        )

    context = "\n\n".join(context_parts)
    system_prompt = (
        "你是一个学术助手。下面提供了若干篇论文的标题和摘要，请根据这些内容回答用户的问题。\n"
        "回答时请用 [序号] 标注你的依据来自哪篇论文，例如 [1][3]。\n"
        "如果所提供的文献不足以回答问题，请明确说明。"
    )
    user_prompt = f"以下是相关论文：\n\n{context}\n\n---\n\n用户问题：{req.question}"

    client = AsyncOpenAI(api_key=req.api_key, base_url=DEEPSEEK_BASE_URL)

    async def stream():
        try:
            stream_resp = await client.chat.completions.create(
                model=req.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                stream=True,
            )
            async for chunk in stream_resp:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
        except Exception as e:
            logger.warning("RAG stream error: %s", e)
            yield f"\n\n[错误：{e}]"

    return StreamingResponse(stream(), media_type="text/plain; charset=utf-8")


# ── POST /api/semantic/graph ──────────────────────────────────────────────────

@router.post("/graph")
async def similarity_graph(req: GraphRequest):
    """
    Compute pairwise semantic similarity graph for a set of papers.
    Returns {nodes, links} for force-directed graph rendering.
    """
    papers_dicts = [
        {
            "paper_id": p.paper_id,
            "title": p.title,
            "abstract": p.abstract,
            "citations": p.citations,
            "source": p.source,
            "published_date": p.published_date,
            "authors": p.authors or [],
        }
        for p in req.papers
    ]
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: compute_similarity_graph(papers_dicts, req.threshold),
    )
    return result


# ── GET /api/semantic/citations/{paper_id} ────────────────────────────────────

_SS_BASE = "https://api.semanticscholar.org/graph/v1/paper"
_SS_FIELDS = "paperId,title,authors,year,citationCount,venue"


def _paper_to_node(item: dict, role: str) -> dict:
    return {
        "id": item.get("paperId", ""),
        "title": item.get("title") or "(no title)",
        "source": "Semantic Scholar",
        "year": str(item.get("year") or ""),
        "citations": item.get("citationCount") or 0,
        "authors": ", ".join(a.get("name", "") for a in (item.get("authors") or [])[:3]),
        "role": role,  # 'reference' | 'citing'
    }


@router.get("/citations/{paper_id}")
async def get_citation_graph(
    paper_id: str,
    limit: int = Query(default=20, ge=1, le=50),
):
    """
    Fetch references and citations for a Semantic Scholar paper.
    Returns {nodes, links} where links have type='cites'.
    """
    fields = _SS_FIELDS
    async with httpx.AsyncClient(timeout=15) as client:
        ref_resp, cit_resp = await asyncio.gather(
            client.get(f"{_SS_BASE}/{paper_id}/references", params={"fields": fields, "limit": limit}),
            client.get(f"{_SS_BASE}/{paper_id}/citations",  params={"fields": fields, "limit": limit}),
            return_exceptions=True,
        )

    nodes: dict[str, dict] = {}
    links: list[dict] = []

    def add_node(item: dict, role: str):
        pid = item.get("paperId") or ""
        if pid and pid not in nodes:
            nodes[pid] = _paper_to_node(item, role)

    if isinstance(ref_resp, httpx.Response) and ref_resp.status_code == 200:
        for entry in ref_resp.json().get("data", []):
            paper = entry.get("citedPaper") or {}
            if paper.get("paperId"):
                add_node(paper, "reference")
                links.append({"source": paper_id, "target": paper["paperId"], "similarity": 0.8, "type": "cites"})

    if isinstance(cit_resp, httpx.Response) and cit_resp.status_code == 200:
        for entry in cit_resp.json().get("data", []):
            paper = entry.get("citingPaper") or {}
            if paper.get("paperId"):
                add_node(paper, "citing")
                links.append({"source": paper["paperId"], "target": paper_id, "similarity": 0.8, "type": "cites"})

    if not nodes and not links:
        raise HTTPException(status_code=404, detail="未找到引用数据（论文可能不在 Semantic Scholar 中）")

    return {"nodes": list(nodes.values()), "links": links}
