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

async def test_get_with_retry_backs_off_exponentially(monkeypatch):
    """限流时按 2s、4s 退避（带抖动），最多 3 次；Semantic Scholar 等源要求指数退避。"""
    from services import search_service as s

    class Resp:
        def __init__(self, code): self.status_code, self.headers = code, {}

    calls = []
    class Client:
        async def get(self, url, **kw):
            calls.append(url)
            return Resp(429)

    waits = []
    monkeypatch.setattr(s.asyncio, "sleep", AsyncMock(side_effect=lambda d: waits.append(d)))
    resp = await s._get_with_retry(Client(), "https://api.semanticscholar.org/graph/v1/paper/search")
    assert resp.status_code == 429
    assert len(calls) == s.RETRY_ATTEMPTS        # 尝试 3 次后放弃
    assert len(waits) == s.RETRY_ATTEMPTS - 1    # 最后一次失败后不再等待
    assert 2 <= waits[0] < 2.5 and 4 <= waits[1] < 4.5  # 指数增长 + 抖动
    assert all(w <= s.RETRY_MAX_WAIT + 0.5 for w in waits)


async def test_get_with_retry_respects_retry_after(monkeypatch):
    from services import search_service as s

    class Resp:
        def __init__(self, code, retry_after=None):
            self.status_code = code
            self.headers = {"retry-after": retry_after} if retry_after else {}

    calls = []
    class Client:
        async def get(self, url, **kw):
            calls.append(url)
            return Resp(429, "6") if len(calls) == 1 else Resp(200)

    waits = []
    monkeypatch.setattr(s.asyncio, "sleep", AsyncMock(side_effect=lambda d: waits.append(d)))
    resp = await s._get_with_retry(Client(), "https://api.semanticscholar.org/graph/v1/paper/search")
    assert resp.status_code == 200 and len(calls) == 2
    assert 6 <= waits[0] < 6.5  # 服务端给了 Retry-After 就听它的


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


# ── 按领域选源 ────────────────────────────────────────────────────────────────

def test_cs_query_skips_biomedical_and_physics_sources():
    from services.search_service import get_source_names
    names = get_source_names(None, ["cs"])
    assert "PubMed" not in names and "Europe PMC" not in names
    assert "INSPIRE-HEP" not in names and "NASA ADS" not in names
    assert {"arXiv", "OpenAlex", "CrossRef", "Semantic Scholar"} <= set(names)


def test_interdisciplinary_query_keeps_all_involved_sources():
    from services.search_service import get_source_names
    names = get_source_names(None, ["cs", "med"])
    assert "PubMed" in names and "Europe PMC" in names
    assert "INSPIRE-HEP" not in names


def test_unknown_or_empty_domains_search_everything():
    from services.search_service import get_source_names, _SOURCE_FUNCS
    everything = list(_SOURCE_FUNCS)
    assert get_source_names(None, []) == everything
    assert get_source_names(None, None) == everything
    assert get_source_names(None, ["cs", "something-new"]) == everything  # 含无法识别的值就不过滤


def test_user_selected_specialist_source_is_respected():
    from services.search_service import get_source_names
    # 用户手动只勾 PubMed，就算识别为计算机领域也不能一个源都不查
    assert get_source_names(["PubMed"], ["cs"]) == ["PubMed"]


# ── OpenAlex 混合检索 ─────────────────────────────────────────────────────────

@pytest.fixture
def stub_httpx(monkeypatch):
    """不依赖本机代理等环境变量创建 httpx 客户端。"""
    from services import search_service as s
    class DummyClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
    monkeypatch.setattr(s.httpx, "AsyncClient", DummyClient)

def test_rrf_fuse_keeps_top_results_from_each_list():
    from services.search_service import _rrf_fuse
    kw = [make_paper(f"k{i}", f"K{i}") for i in range(50)]
    sem = [make_paper("s0", "S0")] + kw[1:50]  # 语义检索第 1 是关键词检索没有的论文，其余与关键词结果重叠
    fused = [p.paper_id for p in _rrf_fuse([kw, sem], limit=50)]
    assert "s0" in fused and "k0" in fused  # 各自排第 1 的都不能被两路都有的尾部结果挤掉
    assert fused.index("k1") < fused.index("k30")  # 两路都靠前的仍然排在前面


async def test_openalex_without_key_runs_keyword_search_only(monkeypatch, stub_httpx):
    from services import search_service as s
    calls = []
    async def fake_request(client, param, query, parsed, limit):
        calls.append(param)
        return [make_paper("W1", "Paper 1", source="OpenAlex")]
    monkeypatch.setattr(s, "OPENALEX_API_KEY", "")
    monkeypatch.setattr(s, "_openalex_request", fake_request)
    assert len(await s._search_openalex(ParsedQuery(keywords=["raft"]), 10)) == 1
    assert calls == ["search"]


async def test_openalex_with_key_fuses_keyword_and_semantic(monkeypatch, stub_httpx):
    from services import search_service as s
    results = {
        "search": [make_paper("W1", "Keyword hit", source="OpenAlex")],
        "search.semantic": [make_paper("W2", "Semantic hit", source="OpenAlex")],
    }
    async def fake_request(client, param, query, parsed, limit):
        return results[param]
    monkeypatch.setattr(s, "OPENALEX_API_KEY", "k")
    monkeypatch.setattr(s, "_openalex_request", fake_request)
    ids = {p.paper_id for p in await s._search_openalex(ParsedQuery(keywords=["raft"]), 10)}
    assert ids == {"W1", "W2"}


async def test_openalex_semantic_failure_keeps_keyword_results(monkeypatch, stub_httpx):
    from services import search_service as s
    async def fake_request(client, param, query, parsed, limit):
        if param == "search.semantic":
            raise RuntimeError("429")
        return [make_paper("W1", "Keyword hit", source="OpenAlex")]
    monkeypatch.setattr(s, "OPENALEX_API_KEY", "k")
    monkeypatch.setattr(s, "_openalex_request", fake_request)
    assert [p.paper_id for p in await s._search_openalex(ParsedQuery(keywords=["raft"]), 10)] == ["W1"]


async def test_semantic_scholar_sends_api_key_header(monkeypatch, stub_httpx):
    from services import search_service as s
    seen = {}
    async def fake_get(client, url, **kwargs):
        seen.update(kwargs.get("headers") or {})
        raise RuntimeError("stop")
    monkeypatch.setattr(s, "_get_with_retry", fake_get)
    monkeypatch.setattr(s, "SEMANTIC_SCHOLAR_HEADERS", {"x-api-key": "k"})
    await s._search_semantic_scholar(ParsedQuery(keywords=["raft"]), 5)
    assert seen == {"x-api-key": "k"}


# ── DOI 登记方的标题优先 ──────────────────────────────────────────────────────

def test_merge_prefers_registrant_title_for_arxiv_doi():
    """OpenAlex 曾把 LoRA 那篇（10.48550/arXiv.2106.09685）的标题挂成另一篇论文的。"""
    from models import Paper
    from services.search_service import deduplicate

    wrong = Paper(paper_id="W1", title="LoRA Fine-Tuning of a 3B Code LLM for Algorithmic Efficiency",
                  authors=["X"], source="OpenAlex", doi="10.48550/arXiv.2106.09685", citations=2543)
    right = Paper(paper_id="2106.09685", title="LoRA: Low-Rank Adaptation of Large Language Models",
                  authors=["Edward J. Hu"], source="arXiv", doi="10.48550/arXiv.2106.09685")
    merged = deduplicate([wrong, right])
    assert len(merged) == 1
    assert merged[0].title == "LoRA: Low-Rank Adaptation of Large Language Models"
    assert merged[0].citations == 2543  # 其他字段仍取更完整的那份


def test_merge_keeps_existing_title_for_publisher_doi():
    """普通期刊 DOI 不做标题替换，避免把正确标题换成别的源的坏数据。"""
    from models import Paper
    from services.search_service import deduplicate

    first = Paper(paper_id="A", title="Attention Is All You Need", authors=["V"], source="OpenAlex", doi="10.1234/abc")
    second = Paper(paper_id="B", title="attention is all you need (preprint draft)", authors=["V"], source="arXiv", doi="10.1234/abc")
    merged = deduplicate([first, second])
    assert len(merged) == 1 and merged[0].title == "Attention Is All You Need"
