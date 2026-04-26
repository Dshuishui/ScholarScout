from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

import pytest

from models import Paper, ParsedQuery
from services.search_service import _merge, _normalize_title, deduplicate, search_all_sources

_ALL_SOURCE_PATHS = [
    "services.search_service._search_arxiv",
    "services.search_service._search_semantic_scholar",
    "services.search_service._search_openalex",
    "services.search_service._search_pubmed",
    "services.search_service._search_core",
    "services.search_service._search_inspire",
    "services.search_service._search_europepmc",
    "services.search_service._search_nasa_ads",
    "services.search_service._search_crossref",
    "services.search_service._search_google_scholar",
]


def make_paper(paper_id, title, doi=None, source="arXiv", abstract=None, url=None, venue=None, citations=0):
    return Paper(
        paper_id=paper_id, title=title, authors=["Author A"],
        source=source, doi=doi, abstract=abstract, url=url,
        venue=venue, citations=citations,
    )


# ── _normalize_title ──────────────────────────────────────────────────────────

def test_normalize_title_strips_trailing_period():
    assert _normalize_title("Deep Learning.") == _normalize_title("Deep Learning")

def test_normalize_title_is_case_insensitive():
    assert _normalize_title("Attention Is All You Need") == _normalize_title("attention is all you need")

def test_normalize_title_collapses_whitespace():
    assert _normalize_title("deep  learning") == _normalize_title("deep learning")


# ── deduplicate ───────────────────────────────────────────────────────────────

def test_deduplicate_by_doi():
    papers = [
        make_paper("1", "Paper A", doi="10.1234/abc"),
        make_paper("2", "Paper A Duplicate", doi="10.1234/abc"),
        make_paper("3", "Paper B", doi="10.1234/xyz"),
    ]
    assert len(deduplicate(papers)) == 2

def test_deduplicate_by_title():
    papers = [
        make_paper("1", "Attention Is All You Need"),
        make_paper("2", "Attention Is All You Need"),
    ]
    assert len(deduplicate(papers)) == 1

def test_deduplicate_title_ignores_trailing_punct():
    papers = [
        make_paper("1", "Paper A."),
        make_paper("2", "Paper A"),
    ]
    assert len(deduplicate(papers)) == 1

def test_deduplicate_keeps_all_unique():
    papers = [make_paper(str(i), f"Paper {i}") for i in range(3)]
    assert len(deduplicate(papers)) == 3


# ── _merge ────────────────────────────────────────────────────────────────────

def test_merge_prefers_longer_abstract():
    p1 = make_paper("1", "T", abstract="short", source="S1")
    p2 = make_paper("2", "T", abstract="much longer abstract here", source="S2")
    assert _merge(p1, p2).abstract == "much longer abstract here"

def test_merge_keeps_higher_citations():
    p1 = make_paper("1", "T", citations=10)
    p2 = make_paper("2", "T", citations=999)
    assert _merge(p1, p2).citations == 999

def test_merge_accumulates_source_links():
    p1 = make_paper("1", "T", source="arXiv", url="https://arxiv.org/abs/1")
    p2 = make_paper("2", "T", source="Semantic Scholar", url="https://s2.org/2")
    merged = _merge(p1, p2)
    sources = {lk["source"] for lk in merged.source_links}
    assert "arXiv" in sources and "Semantic Scholar" in sources

def test_merge_carries_venue():
    p1 = make_paper("1", "T", venue=None)
    p2 = make_paper("2", "T", venue="NeurIPS 2024")
    assert _merge(p1, p2).venue == "NeurIPS 2024"


# ── search_all_sources ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_all_sources_returns_papers():
    query = ParsedQuery(keywords=["transformer"], date_from=None, date_to=None)
    mock_paper = make_paper("2301.00001", "Test Paper")
    mocks = {src: AsyncMock(return_value=[]) for src in _ALL_SOURCE_PATHS}
    mocks["services.search_service._search_arxiv"] = AsyncMock(return_value=[mock_paper])

    with ExitStack() as stack:
        for target, mock in mocks.items():
            stack.enter_context(patch(target, mock))
        result = await search_all_sources(query)

    assert len(result) == 1
    assert result[0].title == "Test Paper"

@pytest.mark.asyncio
async def test_search_all_sources_deduplicates():
    query = ParsedQuery(keywords=["transformer"], date_from=None, date_to=None)
    paper_a = make_paper("1", "Same Title", doi="10.1/abc", source="arXiv", url="https://arxiv.org/1")
    paper_b = make_paper("2", "Same Title", doi="10.1/abc", source="Semantic Scholar", url="https://s2.org/2")
    mocks = {src: AsyncMock(return_value=[]) for src in _ALL_SOURCE_PATHS}
    mocks["services.search_service._search_arxiv"] = AsyncMock(return_value=[paper_a])
    mocks["services.search_service._search_semantic_scholar"] = AsyncMock(return_value=[paper_b])

    with ExitStack() as stack:
        for target, mock in mocks.items():
            stack.enter_context(patch(target, mock))
        result = await search_all_sources(query)

    assert len(result) == 1
    sources = {lk["source"] for lk in result[0].source_links}
    assert "arXiv" in sources and "Semantic Scholar" in sources
