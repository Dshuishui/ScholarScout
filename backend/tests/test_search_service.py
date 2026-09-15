from unittest.mock import AsyncMock, patch

import pytest

from models import Paper, ParsedQuery
from services.search_service import _merge, _normalize_title, deduplicate, search_all_sources

_ALL_SOURCE_NAMES = [
    "arXiv", "Semantic Scholar", "OpenAlex", "PubMed",
    "Europe PMC", "INSPIRE-HEP", "CrossRef", "CORE", "NASA ADS", "Google Scholar",
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

def test_normalize_title_non_ascii_not_empty():
    # 纯非拉丁标题不能归一化为空串，否则 deduplicate 会整篇丢弃
    assert _normalize_title("深度学习综述") != ""
    assert _normalize_title("αβγ衰变") != ""

def test_normalize_title_non_ascii_stable():
    # 相同非 ASCII 标题归一化结果一致（大小写/空白无关）
    assert _normalize_title("深度学习  综述") == _normalize_title("深度学习 综述")


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

def test_deduplicate_keeps_non_ascii_titled_paper():
    # 回归：中文标题论文曾因归一化空 key 被静默丢弃
    papers = [
        make_paper("1", "深度学习在医学图像分割中的应用"),
        make_paper("2", "Deep Learning for Medical Imaging"),
    ]
    assert len(deduplicate(papers)) == 2

def test_deduplicate_merges_identical_non_ascii_titles():
    papers = [
        make_paper("1", "深度学习综述", source="PubMed", citations=5),
        make_paper("2", "深度学习综述", source="CrossRef", citations=10),
    ]
    result = deduplicate(papers)
    assert len(result) == 1
    assert result[0].citations == 10

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
    source_mocks = {src: AsyncMock(return_value=[]) for src in _ALL_SOURCE_NAMES}
    source_mocks["arXiv"] = AsyncMock(return_value=[mock_paper])

    with patch.dict("services.search_service._SOURCE_FUNCS", source_mocks):
        result = await search_all_sources(query)

    assert len(result) == 1
    assert result[0].title == "Test Paper"

@pytest.mark.asyncio
async def test_search_all_sources_deduplicates():
    query = ParsedQuery(keywords=["transformer"], date_from=None, date_to=None)
    paper_a = make_paper("1", "Same Title", doi="10.1/abc", source="arXiv", url="https://arxiv.org/1")
    paper_b = make_paper("2", "Same Title", doi="10.1/abc", source="Semantic Scholar", url="https://s2.org/2")
    source_mocks = {src: AsyncMock(return_value=[]) for src in _ALL_SOURCE_NAMES}
    source_mocks["arXiv"] = AsyncMock(return_value=[paper_a])
    source_mocks["Semantic Scholar"] = AsyncMock(return_value=[paper_b])

    with patch.dict("services.search_service._SOURCE_FUNCS", source_mocks):
        result = await search_all_sources(query)

    assert len(result) == 1
    sources = {lk["source"] for lk in result[0].source_links}
    assert "arXiv" in sources and "Semantic Scholar" in sources


# ── 429 重试 / Google Scholar ────────────────────────────────────────────────

async def test_get_with_retry_retries_once_on_429(monkeypatch):
    from services import search_service as s

    class Resp:
        def __init__(self, code): self.status_code, self.headers = code, {"retry-after": "0"}

    calls = []
    class Client:
        async def get(self, url, **kw):
            calls.append(url)
            return Resp(429 if len(calls) == 1 else 200)

    monkeypatch.setattr(s.asyncio, "sleep", AsyncMock())
    resp = await s._get_with_retry(Client(), "https://api.openalex.org/works")
    assert resp.status_code == 200
    assert len(calls) == 2


async def test_google_scholar_without_serpapi_key_returns_fast(monkeypatch):
    # 以前会先用 scholarly 走代理，代理失效时每次搜索卡 15 秒
    import time
    from services import search_service as s
    monkeypatch.setattr(s, "SERPAPI_KEY", "")
    t = time.monotonic()
    assert await s._search_google_scholar(ParsedQuery(keywords=["raft"]), 5) == []
    assert time.monotonic() - t < 1


# ── 各源查询构造 ──────────────────────────────────────────────────────────────

def test_quoted_or_quotes_phrases_only():
    from services.search_service import _quoted_or
    assert _quoted_or(["latent diffusion model", "LoRA", ' "quoted" term ']) == \
        '"latent diffusion model" OR LoRA OR "quoted term"'


async def _capture_params(monkeypatch, fn, parsed):
    """调用某个数据源函数，返回它请求时带的 params（不真正联网）。"""
    from services import search_service as s
    captured = {}

    async def fake_get(client, url, **kwargs):
        captured.update(kwargs.get("params", {}))
        raise RuntimeError("stop after capturing")

    class DummyClient:  # 不依赖本机代理等环境变量
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False

    monkeypatch.setattr(s.httpx, "AsyncClient", DummyClient)
    monkeypatch.setattr(s, "_get_with_retry", fake_get)
    assert await fn(parsed, 10) == []
    return captured


async def test_openalex_uses_boolean_or(monkeypatch):
    from services import search_service as s
    p = await _capture_params(monkeypatch, s._search_openalex,
                              ParsedQuery(keywords=["latent diffusion model", "image synthesis"]))
    assert p["search"] == '"latent diffusion model" OR "image synthesis"'


async def test_arxiv_sorts_by_relevance_even_with_date(monkeypatch):
    from services import search_service as s
    p = await _capture_params(monkeypatch, s._search_arxiv,
                              ParsedQuery(keywords=["raft"], date_from="2021-01-01"))
    assert p["sortBy"] == "relevance"
    assert "submittedDate:[20210101000000 TO *]" in p["search_query"]


async def test_pubmed_sorts_by_relevance(monkeypatch):
    from services import search_service as s
    p = await _capture_params(monkeypatch, s._search_pubmed, ParsedQuery(keywords=["semaglutide", "obesity"]))
    assert p["sort"] == "relevance"


async def test_inspire_or_query_with_default_relevance_sort(monkeypatch):
    from services import search_service as s
    p = await _capture_params(monkeypatch, s._search_inspire,
                              ParsedQuery(keywords=["gravitational waves", "LIGO"], date_from="2015-01-01"))
    assert p["q"] == '("gravitational waves" or "LIGO") AND date>2015'
    assert "sort" not in p


async def test_nasa_ads_sorts_by_score(monkeypatch):
    from services import search_service as s
    monkeypatch.setattr(s, "NASA_ADS_API_KEY", "k")
    p = await _capture_params(monkeypatch, s._search_nasa_ads, ParsedQuery(keywords=["exoplanet"]))
    assert p["sort"] == "score desc"
