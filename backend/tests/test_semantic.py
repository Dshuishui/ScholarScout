"""Tests for /api/semantic/* endpoints."""
from unittest.mock import AsyncMock, MagicMock, patch
from typing import AsyncIterator

import httpx
import pytest


# ── helpers ───────────────────────────────────────────────────────────────────

def _graph_papers(n: int = 2):
    return [
        {"paper_id": f"p{i}", "title": f"Paper {i}", "abstract": f"Abstract {i}",
         "citations": i * 10, "source": "arXiv"}
        for i in range(1, n + 1)
    ]


def _make_ss_response(data: list) -> MagicMock:
    # spec=httpx.Response so isinstance(..., httpx.Response) passes in production code
    m = MagicMock(spec=httpx.Response)
    m.status_code = 200
    m.json.return_value = {"data": data}
    return m


# ── GET /api/semantic/status ──────────────────────────────────────────────────

async def test_semantic_status(client):
    with patch("routers.semantic.collection_count", return_value=42):
        r = await client.get("/api/semantic/status")
    assert r.status_code == 200
    assert r.json()["indexed_count"] == 42


async def test_semantic_status_zero(client):
    with patch("routers.semantic.collection_count", return_value=0):
        r = await client.get("/api/semantic/status")
    assert r.json()["indexed_count"] == 0


# ── POST /api/semantic/search ─────────────────────────────────────────────────

async def test_semantic_search_returns_results(client):
    mock_results = [{"paper_id": "p1", "title": "Transformer", "score": 0.95}]
    with patch("routers.semantic.semantic_search", return_value=mock_results):
        r = await client.post("/api/semantic/search", json={"query": "transformer models"})
    assert r.status_code == 200
    body = r.json()
    assert body["query"] == "transformer models"
    assert body["results"] == mock_results


async def test_semantic_search_empty_query_rejected(client):
    r = await client.post("/api/semantic/search", json={"query": ""})
    assert r.status_code == 422


async def test_semantic_search_query_too_long(client):
    r = await client.post("/api/semantic/search", json={"query": "x" * 501})
    assert r.status_code == 422


# ── POST /api/semantic/graph ──────────────────────────────────────────────────

async def test_similarity_graph_returns_nodes_and_links(client):
    mock_graph = {
        "nodes": [{"id": "p1"}, {"id": "p2"}],
        "links": [{"source": "p1", "target": "p2", "similarity": 0.8}],
    }
    with patch("routers.semantic.compute_similarity_graph", return_value=mock_graph):
        r = await client.post("/api/semantic/graph", json={
            "papers": _graph_papers(2), "threshold": 0.5,
        })
    assert r.status_code == 200
    data = r.json()
    assert len(data["nodes"]) == 2
    assert len(data["links"]) == 1
    assert data["links"][0]["similarity"] == pytest.approx(0.8)


async def test_similarity_graph_requires_two_papers(client):
    r = await client.post("/api/semantic/graph", json={
        "papers": _graph_papers(1), "threshold": 0.5,
    })
    assert r.status_code == 422


async def test_similarity_graph_threshold_out_of_range(client):
    r = await client.post("/api/semantic/graph", json={
        "papers": _graph_papers(2), "threshold": 1.5,
    })
    assert r.status_code == 422


async def test_similarity_graph_empty_result(client):
    with patch("routers.semantic.compute_similarity_graph", return_value={"nodes": [], "links": []}):
        r = await client.post("/api/semantic/graph", json={
            "papers": _graph_papers(2), "threshold": 0.99,
        })
    assert r.status_code == 200
    assert r.json()["nodes"] == []


# ── GET /api/semantic/citations/{paper_id} ────────────────────────────────────

def _mock_httpx_client(ref_data: list, cit_data: list):
    """Return a context-manager mock for httpx.AsyncClient."""
    async def mock_get(url, **kwargs):
        if "references" in url:
            return _make_ss_response(ref_data)
        return _make_ss_response(cit_data)

    mock_client = AsyncMock()
    mock_client.get = mock_get

    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=mock_client)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


async def test_citation_graph_returns_nodes_and_links(client):
    ref_paper = {
        "paperId": "ref1", "title": "Referenced Paper",
        "year": 2022, "citationCount": 100,
        "authors": [{"name": "Author A"}], "venue": "NeurIPS",
    }
    cit_paper = {
        "paperId": "cit1", "title": "Citing Paper",
        "year": 2023, "citationCount": 5,
        "authors": [], "venue": None,
    }
    ctx = _mock_httpx_client(
        ref_data=[{"citedPaper": ref_paper}],
        cit_data=[{"citingPaper": cit_paper}],
    )
    with patch("routers.semantic.httpx.AsyncClient", return_value=ctx):
        r = await client.get("/api/semantic/citations/abc123")

    assert r.status_code == 200
    data = r.json()
    node_ids = {n["id"] for n in data["nodes"]}
    assert "ref1" in node_ids
    assert "cit1" in node_ids
    assert len(data["links"]) == 2
    assert all(lk["type"] == "cites" for lk in data["links"])


async def test_citation_graph_reference_link_direction(client):
    """seed → ref (seed cites ref), cit → seed (cit cites seed)."""
    ref_paper = {"paperId": "ref1", "title": "Ref", "year": 2020,
                 "citationCount": 0, "authors": [], "venue": None}
    ctx = _mock_httpx_client(
        ref_data=[{"citedPaper": ref_paper}],
        cit_data=[],
    )
    with patch("routers.semantic.httpx.AsyncClient", return_value=ctx):
        r = await client.get("/api/semantic/citations/seed123")

    assert r.status_code == 200
    links = r.json()["links"]
    assert len(links) == 1
    assert links[0]["source"] == "seed123"
    assert links[0]["target"] == "ref1"


async def test_citation_graph_404_when_no_data(client):
    ctx = _mock_httpx_client(ref_data=[], cit_data=[])
    with patch("routers.semantic.httpx.AsyncClient", return_value=ctx):
        r = await client.get("/api/semantic/citations/nonexistent")
    assert r.status_code == 404


async def test_citation_graph_ignores_entries_without_paper_id(client):
    bad_entry = {"citedPaper": {"paperId": "", "title": "No ID", "year": 2021,
                                "citationCount": 0, "authors": [], "venue": None}}
    valid_entry = {"citedPaper": {"paperId": "valid1", "title": "Valid",
                                  "year": 2022, "citationCount": 10,
                                  "authors": [], "venue": None}}
    ctx = _mock_httpx_client(ref_data=[bad_entry, valid_entry], cit_data=[])
    with patch("routers.semantic.httpx.AsyncClient", return_value=ctx):
        r = await client.get("/api/semantic/citations/seed")

    assert r.status_code == 200
    node_ids = {n["id"] for n in r.json()["nodes"]}
    assert "" not in node_ids
    assert "valid1" in node_ids


async def test_citation_graph_respects_limit_param(client):
    ctx = _mock_httpx_client(ref_data=[], cit_data=[])
    with patch("routers.semantic.httpx.AsyncClient", return_value=ctx):
        r = await client.get("/api/semantic/citations/p1?limit=5")
    # 404 because no data, but the request itself should be valid
    assert r.status_code == 404


async def test_citation_graph_limit_out_of_range(client):
    r = await client.get("/api/semantic/citations/p1?limit=0")
    assert r.status_code == 422

    r = await client.get("/api/semantic/citations/p1?limit=51")
    assert r.status_code == 422


# ── POST /api/semantic/rag ────────────────────────────────────────────────────

_RAG_PAPERS = [
    {"paper_id": "p1", "title": "Attention Is All You Need",
     "abstract": "We propose the Transformer architecture.", "authors": ["Vaswani et al."],
     "published_date": "2017-01-01", "source": "arXiv"},
    {"paper_id": "p2", "title": "BERT",
     "abstract": "Bidirectional pre-training for NLP.", "authors": ["Devlin et al."],
     "published_date": "2018-01-01", "source": "arXiv"},
]


async def _make_rag_stream(*tokens: str):
    """Build an async iterator of mock OpenAI streaming chunks."""
    async def _gen() -> AsyncIterator:
        for tok in tokens:
            chunk = MagicMock()
            chunk.choices = [MagicMock()]
            chunk.choices[0].delta.content = tok
            yield chunk
    return _gen()


def _patch_openai(stream):
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(return_value=stream)
    mock_cls = MagicMock(return_value=mock_client)
    return patch("routers.semantic.AsyncOpenAI", mock_cls)


async def test_rag_streams_text_response(client):
    stream = await _make_rag_stream("根据", "论文", "[1]", "，Transformer", "效果好。")
    with _patch_openai(stream):
        r = await client.post("/api/semantic/rag", json={
            "question": "这些论文的主要贡献是什么？",
            "papers": _RAG_PAPERS,
            "api_key": "test-key",
        })
    assert r.status_code == 200
    assert "根据" in r.text
    assert "[1]" in r.text


async def test_rag_response_is_plain_text(client):
    stream = await _make_rag_stream("hello")
    with _patch_openai(stream):
        r = await client.post("/api/semantic/rag", json={
            "question": "test",
            "papers": _RAG_PAPERS,
            "api_key": "sk-test",
        })
    assert "text/plain" in r.headers["content-type"]


async def test_rag_empty_question_rejected(client):
    r = await client.post("/api/semantic/rag", json={
        "question": "",
        "papers": _RAG_PAPERS,
        "api_key": "sk-test",
    })
    assert r.status_code == 422


async def test_rag_missing_api_key_rejected(client):
    r = await client.post("/api/semantic/rag", json={
        "question": "What is this about?",
        "papers": _RAG_PAPERS,
        "api_key": "",
    })
    assert r.status_code == 422


async def test_rag_requires_at_least_one_paper(client):
    r = await client.post("/api/semantic/rag", json={
        "question": "test",
        "papers": [],
        "api_key": "sk-test",
    })
    assert r.status_code == 422


async def test_rag_handles_openai_error_gracefully(client):
    mock_client = AsyncMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=Exception("API quota exceeded"))
    with patch("routers.semantic.AsyncOpenAI", MagicMock(return_value=mock_client)):
        r = await client.post("/api/semantic/rag", json={
            "question": "test",
            "papers": _RAG_PAPERS,
            "api_key": "sk-test",
        })
    assert r.status_code == 200
    assert "错误" in r.text


async def test_rag_includes_paper_context_in_prompt(client):
    """Verify abstracts are passed through — mock captures the messages."""
    captured: list = []

    async def _fake_create(**kwargs):
        captured.append(kwargs.get("messages", []))
        return await _make_rag_stream("ok")

    mock_client = AsyncMock()
    mock_client.chat.completions.create = _fake_create
    with patch("routers.semantic.AsyncOpenAI", MagicMock(return_value=mock_client)):
        await client.post("/api/semantic/rag", json={
            "question": "contributions?",
            "papers": _RAG_PAPERS,
            "api_key": "sk-test",
        })

    assert captured
    user_msg = next(m["content"] for m in captured[0] if m["role"] == "user")
    assert "Attention Is All You Need" in user_msg
    assert "BERT" in user_msg
