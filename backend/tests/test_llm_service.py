import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from services.llm_service import parse_query, validate_papers
from models import ParsedQuery, Paper


@pytest.mark.asyncio
async def test_parse_query_extracts_keywords():
    mock_response = MagicMock()
    mock_response.choices[0].message.content = json.dumps({
        "keywords": ["RAG", "retrieval augmented generation"],
        "date_from": "2023-01-01",
        "date_to": None,
        "max_results": 30
    })

    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat.completions.create = AsyncMock(return_value=mock_response)
        result = await parse_query("找2023年后RAG相关的论文", "sk-fake-key")

    assert isinstance(result, ParsedQuery)
    assert "RAG" in result.keywords
    assert result.date_from == "2023-01-01"
    assert result.date_to is None


@pytest.mark.asyncio
async def test_parse_query_no_date():
    mock_response = MagicMock()
    mock_response.choices[0].message.content = json.dumps({
        "keywords": ["transformer", "attention mechanism"],
        "date_from": None,
        "date_to": None,
        "max_results": 30
    })

    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat.completions.create = AsyncMock(return_value=mock_response)
        result = await parse_query("找transformer相关论文", "sk-fake-key")

    assert result.date_from is None
    assert "transformer" in result.keywords


@pytest.mark.asyncio
async def test_validate_papers_filters_irrelevant():
    papers = [
        Paper(paper_id="1", title="RAG for Legal Documents", authors=["A"],
              abstract="We apply RAG to legal text retrieval.", source="arXiv"),
        Paper(paper_id="2", title="Image Classification with CNN", authors=["B"],
              abstract="We train CNNs on ImageNet.", source="arXiv"),
    ]
    mock_response = MagicMock()
    mock_response.choices[0].message.content = json.dumps([
        {"id": "1", "relevant": True,  "reason": "直接研究 RAG 应用"},
        {"id": "2", "relevant": False, "reason": "与 RAG 无关"},
    ])

    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat.completions.create = AsyncMock(return_value=mock_response)
        result = await validate_papers(papers, "找RAG相关论文", "sk-fake-key")

    assert len(result) == 1
    assert result[0].paper_id == "1"
    assert result[0].relevance_reason == "直接研究 RAG 应用"
