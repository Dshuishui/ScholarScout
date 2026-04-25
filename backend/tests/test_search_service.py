import pytest
from unittest.mock import patch
from services.search_service import deduplicate, search_all_sources
from models import Paper, ParsedQuery


def make_paper(paper_id, title, doi=None, source="arXiv"):
    return Paper(paper_id=paper_id, title=title, authors=["Author A"],
                 source=source, doi=doi)


def test_deduplicate_by_doi():
    papers = [
        make_paper("1", "Paper A", doi="10.1234/abc"),
        make_paper("2", "Paper A Duplicate", doi="10.1234/abc"),
        make_paper("3", "Paper B", doi="10.1234/xyz"),
    ]
    result = deduplicate(papers)
    assert len(result) == 2


def test_deduplicate_by_title():
    papers = [
        make_paper("1", "Attention Is All You Need"),
        make_paper("2", "Attention Is All You Need"),
    ]
    result = deduplicate(papers)
    assert len(result) == 1


def test_deduplicate_keeps_all_unique():
    papers = [
        make_paper("1", "Paper A"),
        make_paper("2", "Paper B"),
        make_paper("3", "Paper C"),
    ]
    result = deduplicate(papers)
    assert len(result) == 3


@pytest.mark.asyncio
async def test_search_all_sources_returns_papers():
    query = ParsedQuery(keywords=["transformer"], date_from=None, date_to=None)
    mock_paper = make_paper("2301.00001", "Test Paper")

    with patch("services.search_service._search_arxiv", return_value=[mock_paper]), \
         patch("services.search_service._search_semantic_scholar", return_value=[]), \
         patch("services.search_service._search_openalex", return_value=[]):
        result = await search_all_sources(query)

    assert len(result) == 1
    assert result[0].title == "Test Paper"


@pytest.mark.asyncio
async def test_search_all_sources_deduplicates():
    query = ParsedQuery(keywords=["transformer"], date_from=None, date_to=None)
    paper_a = make_paper("1", "Same Title", doi="10.1/abc", source="arXiv")
    paper_b = make_paper("2", "Same Title", doi="10.1/abc", source="Semantic Scholar")

    with patch("services.search_service._search_arxiv", return_value=[paper_a]), \
         patch("services.search_service._search_semantic_scholar", return_value=[paper_b]), \
         patch("services.search_service._search_openalex", return_value=[]):
        result = await search_all_sources(query)

    assert len(result) == 1
