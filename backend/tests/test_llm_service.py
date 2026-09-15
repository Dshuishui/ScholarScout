import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from models import Paper, ParsedQuery
from services.llm_service import parse_query, validate_papers, rank_accepted


def _mock_llm(content):
    resp = MagicMock()
    resp.choices[0].message.content = json.dumps(content)
    return resp


# ── parse_query ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_parse_query_extracts_keywords():
    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        MockClient.return_value.chat.completions.create = AsyncMock(return_value=_mock_llm({
            "keywords": ["RAG", "retrieval augmented generation"],
            "date_from": "2023-01-01", "date_to": None, "max_results": 30,
        }))
        result = await parse_query("找2023年后RAG相关的论文", "sk-fake-key")

    assert isinstance(result, ParsedQuery)
    assert "RAG" in result.keywords
    assert result.date_from == "2023-01-01"
    assert result.date_to is None


@pytest.mark.asyncio
async def test_parse_query_no_date():
    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        MockClient.return_value.chat.completions.create = AsyncMock(return_value=_mock_llm({
            "keywords": ["transformer", "attention mechanism"],
            "date_from": None, "date_to": None, "max_results": 30,
        }))
        result = await parse_query("找transformer相关论文", "sk-fake-key")

    # 用户没说时间就不限年份（以前默认近 5 年，会漏掉奠基论文）
    assert result.date_from is None
    assert "transformer" in result.keywords


# ── validate_papers ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_validate_papers_filters_irrelevant():
    papers = [
        Paper(paper_id="1", title="RAG for Legal Documents", authors=["A"],
              abstract="We apply RAG to legal text retrieval.", source="arXiv"),
        Paper(paper_id="2", title="Image Classification with CNN", authors=["B"],
              abstract="We train CNNs on ImageNet.", source="arXiv"),
    ]
    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        MockClient.return_value.chat.completions.create = AsyncMock(return_value=_mock_llm({
            "results": [
                {"id": "1", "score": 9, "reason": "直接研究 RAG 应用", "tldr": "将RAG应用于法律文本检索"},
                {"id": "2", "score": 1, "reason": "与 RAG 无关", "tldr": "CNN图像分类"},
            ]
        }))
        accepted, rejected = await validate_papers(papers, "找RAG相关论文", "sk-fake-key")

    assert len(accepted) == 1
    assert accepted[0].paper_id == "1"
    assert accepted[0].relevance_reason == "直接研究 RAG 应用"
    assert accepted[0].relevance_score == 9.0
    assert accepted[0].tldr == "将RAG应用于法律文本检索"


@pytest.mark.asyncio
async def test_validate_papers_returns_rejected():
    papers = [
        Paper(paper_id="1", title="RAG Survey", authors=["A"], source="arXiv"),
        Paper(paper_id="2", title="Unrelated CNN Paper", authors=["B"], source="arXiv"),
    ]
    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        MockClient.return_value.chat.completions.create = AsyncMock(return_value=_mock_llm({
            "results": [
                {"id": "1", "score": 8, "reason": "相关", "tldr": "RAG综述"},
                {"id": "2", "score": 2, "reason": "不相关", "tldr": "CNN分类"},
            ]
        }))
        accepted, rejected = await validate_papers(papers, "找RAG相关论文", "sk-fake-key")

    assert len(rejected) == 1
    assert rejected[0].paper_id == "2"


@pytest.mark.asyncio
async def test_validate_papers_empty_input():
    accepted, rejected = await validate_papers([], "query", "sk-fake-key")
    assert accepted == []
    assert rejected == []


@pytest.mark.asyncio
async def test_validate_papers_failed_batch_is_retried_then_kept():
    # 回归：某一批调用失败时，这 20 篇曾既不在 accepted 也不在 rejected，悄悄消失
    papers = [Paper(paper_id=str(i), title=f"P{i}", authors=["A"], source="arXiv") for i in range(25)]
    ok = _mock_llm({"results": [{"id": str(i), "score": 8, "reason": "r", "tldr": "t"} for i in range(20, 25)]})

    calls = {"n": 0}
    async def create(**kwargs):
        calls["n"] += 1
        if "ID: 0\n" in kwargs["messages"][0]["content"]:  # 第一批（0-19）始终失败
            raise RuntimeError("upstream timeout")
        return ok

    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        MockClient.return_value.chat.completions.create = create
        accepted, rejected = await validate_papers(papers, "q", "sk-fake-key")

    assert len(accepted) + len(rejected) == 25
    assert {p.paper_id for p in accepted} >= {str(i) for i in range(20)}  # 失败批次原样保留
    assert calls["n"] == 3  # 失败批次重试了一次


def test_rank_accepted_sorts_by_score_before_truncation():
    # 回归：以前先按数据源合并顺序截取前 N 篇再排序，后面数据源的高分论文会被先截掉
    papers = [
        Paper(paper_id="a", title="A", authors=[], source="OpenAlex", relevance_score=5),
        Paper(paper_id="unscored", title="U", authors=[], source="OpenAlex"),
        Paper(paper_id="b", title="B", authors=[], source="CrossRef", relevance_score=9),
        Paper(paper_id="c", title="C", authors=[], source="CrossRef", relevance_score=5),
    ]
    assert [p.paper_id for p in rank_accepted(papers)] == ["b", "a", "c", "unscored"]
    assert [p.paper_id for p in rank_accepted(papers)[:1]] == ["b"]


def test_citation_bonus_is_bounded():
    from services.llm_service import citation_bonus
    assert citation_bonus(0) == 0
    assert 0.45 < citation_bonus(100) < 0.55
    assert citation_bonus(10_000) == 1.0
    assert citation_bonus(10_000_000) == 1.0


def test_rank_accepted_breaks_score_ties_by_citations():
    papers = [
        Paper(paper_id="new", title="N", authors=[], source="OpenAlex", relevance_score=8, citations=3),
        Paper(paper_id="classic", title="C", authors=[], source="OpenAlex", relevance_score=8, citations=90000),
        Paper(paper_id="best-match", title="B", authors=[], source="OpenAlex", relevance_score=10, citations=0),
    ]
    # 同为 8 分时高引的奠基论文在前；但 10 分的论文不会被 8 分的高引论文反超
    assert [p.paper_id for p in rank_accepted(papers)] == ["best-match", "classic", "new"]


@pytest.mark.asyncio
async def test_parse_query_returns_domains():
    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        MockClient.return_value.chat.completions.create = AsyncMock(return_value=_mock_llm({
            "keywords": ["deep learning", "medical imaging"], "date_from": None, "date_to": None,
            "max_results": 30, "domains": ["cs", "med"],
        }))
        result = await parse_query("深度学习用于医学影像", "sk-fake-key")
    assert result.domains == ["cs", "med"]
