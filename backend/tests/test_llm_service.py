import json
import re
import pytest
from datetime import date
from unittest.mock import AsyncMock, patch, MagicMock

from models import Paper, ParsedQuery
from services.llm_service import parse_query, validate_papers


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

    # 未指定日期时应自动回填近 5 年的默认值
    assert result.date_from is not None
    assert re.match(r"\d{4}-01-01", result.date_from)
    assert int(result.date_from[:4]) >= date.today().year - 5
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
