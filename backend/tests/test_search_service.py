from unittest.mock import AsyncMock, patch

import pytest

from models import Paper, ParsedQuery
from services.search_service import _merge, _normalize_title, deduplicate, search_all_sources
from services.search_service import _abstracts_from_openalex  # conftest 会替换掉模块里的这个函数，这里留住真的

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
    from services.search_service import get_source_names, available_sources
    everything = available_sources()
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


# ── OpenAlex 语义检索与日期筛选 ───────────────────────────────────────────────

async def test_openalex_semantic_filters_dates_client_side(monkeypatch):
    """OpenAlex 语义检索不接受日期 filter（带上整个请求 400），要拿回来再筛。"""
    from services import search_service as s
    from models import ParsedQuery

    sent = {}

    class Resp:
        status_code = 200
        headers = {}
        def raise_for_status(self): pass
        def json(self):
            return {"results": [
                {"id": "https://openalex.org/W1", "title": "新的", "publication_date": "2024-05-01"},
                {"id": "https://openalex.org/W2", "title": "太旧", "publication_date": "2019-01-01"},
            ]}

    class Client:
        async def get(self, url, **kw):
            sent.update(kw.get("params", {}))
            return Resp()

    parsed = ParsedQuery(keywords=["diffusion"], date_from="2023-01-01")
    papers = await s._openalex_request(Client(), "search.semantic", "diffusion", parsed, 50)
    assert "filter" not in sent                     # 不能带日期 filter
    assert sent["per_page"] <= 50                   # 语义检索每页最多 50，超过整个请求 400
    assert [p.title for p in papers] == ["新的"]     # 旧的在本地筛掉

    sent.clear()
    await s._openalex_request(Client(), "search", "diffusion", parsed, 50)
    assert sent["filter"] == "publication_date:>2023-01-01"  # 关键词检索仍然交给服务端筛


# ── 没配 key 的数据源 ─────────────────────────────────────────────────────────

def test_sources_without_key_are_not_searched(monkeypatch):
    """CORE / NASA ADS / Google Scholar 没 key 就永远返回 0 篇，不该浪费一次调用。"""
    from services import search_service as s
    for attr in ("CORE_API_KEY", "NASA_ADS_API_KEY", "SERPAPI_KEY"):
        monkeypatch.setattr(s.config, attr, "")
    names = s.available_sources()
    assert {"CORE", "NASA ADS", "Google Scholar"}.isdisjoint(names)
    assert "OpenAlex" in names and "arXiv" in names
    assert "CORE" not in s.get_source_names(["CORE", "OpenAlex"], None)


def test_configured_key_enables_source(monkeypatch):
    from services import search_service as s
    monkeypatch.setattr(s.config, "CORE_API_KEY", "key-123")
    assert "CORE" in s.available_sources()


# ── 无 Redis 时的进程内缓存 ───────────────────────────────────────────────────

async def test_search_cache_works_without_redis():
    """线上没配 Redis：同样的关键词重复搜索也应该拿到同一份结果，而不是重新搜一遍。"""
    from services import cache_service as cs
    cs._memory_cache.clear()
    args = (["graph neural network"], ["OpenAlex"], "", "")
    assert await cs.get_cached_search(*args) is None
    await cs.cache_search(["graph neural network"], ["OpenAlex"], [{"paper_id": "p1"}], "", "")
    assert await cs.get_cached_search(*args) == [{"paper_id": "p1"}]
    await cs.invalidate_search(*args)
    assert await cs.get_cached_search(*args) is None


async def test_search_cache_respects_ttl_and_capacity():
    from services import cache_service as cs
    cs._memory_cache.clear()
    await cs.cache_search(["a"], ["OpenAlex"], [{"paper_id": "x"}], "", "", ttl=-1)
    assert await cs.get_cached_search(["a"], ["OpenAlex"], "", "") is None  # 过期即失效
    for i in range(cs._MEMORY_CACHE_MAX + 5):
        await cs.cache_search([f"kw{i}"], ["OpenAlex"], [{"paper_id": str(i)}], "", "")
    assert len(cs._memory_cache) <= cs._MEMORY_CACHE_MAX  # 有容量上限，不会无限增长


# ── 概念交集 + 按被引排序 ─────────────────────────────────────────────────────

def test_parsed_query_normalizes_concepts():
    """大模型返回的格式不规整时不能让整次搜索报错。"""
    assert ParsedQuery(keywords=["x"], concepts=None).concepts == []
    assert ParsedQuery(keywords=["x"], concepts=["raft", ["consensus", " ", 3]]).concepts == [["raft"], ["consensus"]]
    many = ParsedQuery(keywords=["x"], concepts=[[f"c{i}", "a", "b", "c", "d"] for i in range(5)]).concepts
    assert len(many) == 3 and all(len(g) == 4 for g in many)


def test_concept_query_ands_groups_and_ors_synonyms():
    from services.search_service import _concept_query
    q = _concept_query([["reinforcement learning", "ADP"], ["missile guidance"]])
    assert q == '("reinforcement learning" OR ADP) AND ("missile guidance")'


async def test_openalex_title_abstract_request_uses_filter_and_sort():
    from services import search_service as s
    sent = {}

    class Resp:
        status_code = 200
        headers = {}
        def raise_for_status(self): pass
        def json(self): return {"results": []}

    class Client:
        async def get(self, url, **kw):
            sent.update(kw.get("params", {}))
            return Resp()

    parsed = ParsedQuery(keywords=["raft"], date_from="2015-01-01")
    await s._openalex_request(Client(), s.OPENALEX_TITLE_ABSTRACT, "(raft, consensus)", parsed, 10,
                              sort="cited_by_count:desc")
    assert "search" not in sent  # search 参数连全文一起匹配
    assert sent["filter"] == "title_and_abstract.search:(raft  consensus),publication_date:>2015-01-01"
    assert sent["sort"] == "cited_by_count:desc"


def _fake_openalex(results: dict, calls: list):
    async def fake_request(client, param, query, parsed, limit, sort=None):
        name = "cited" if sort else ("intersection" if " AND " in query or query.startswith("(") else param)
        calls.append((name, query))
        return results.get(name, [])
    return fake_request


async def test_openalex_with_concepts_adds_intersection_and_cited(monkeypatch, stub_httpx):
    from services import search_service as s
    kw = [make_paper(f"K{i}", f"Keyword {i}", source="OpenAlex") for i in range(5)]
    results = {
        "search": kw,
        "intersection": [make_paper("I1", "Intersection hit", source="OpenAlex")],
        "cited": [make_paper("C1", "Classic", source="OpenAlex"), kw[0]],
    }
    calls = []
    monkeypatch.setattr(s, "OPENALEX_API_KEY", "k")
    monkeypatch.setattr(s, "_openalex_request", _fake_openalex(results, calls))
    parsed = ParsedQuery(keywords=["rl", "guidance"], concepts=[["rl"], ["missile guidance"]])
    ids = [p.paper_id for p in await s._search_openalex(parsed, 5)]
    assert "I1" in ids                      # 交集检索参与融合
    assert ids[-1] == "C1" and len(ids) == 6  # 按被引那一路追加在后面，不被截掉，也不重复
    assert ("cited", '(rl) AND ("missile guidance")') in calls


async def test_openalex_single_concept_skips_intersection(monkeypatch, stub_httpx):
    from services import search_service as s
    calls = []
    monkeypatch.setattr(s, "OPENALEX_API_KEY", "k")
    monkeypatch.setattr(s, "_openalex_request", _fake_openalex({}, calls))
    await s._search_openalex(ParsedQuery(keywords=["transformer"], concepts=[["transformer", "self-attention"]]), 10)
    assert sorted(name for name, _ in calls) == ["cited", "search", "search.semantic"]


async def test_openalex_without_key_ignores_concepts(monkeypatch, stub_httpx):
    from services import search_service as s
    calls = []
    monkeypatch.setattr(s, "OPENALEX_API_KEY", "")
    monkeypatch.setattr(s, "_openalex_request", _fake_openalex({}, calls))
    await s._search_openalex(ParsedQuery(keywords=["rl"], concepts=[["rl"], ["guidance"]]), 10)
    assert [name for name, _ in calls] == ["search"]


async def test_openalex_intersection_drops_last_concept_when_too_few(stub_httpx, monkeypatch):
    from services import search_service as s
    queries = []
    async def fake_request(client, param, query, parsed, limit, sort=None):
        queries.append(query)
        if query.count(" AND ") == 2:
            return [make_paper("S1", "Strict", source="OpenAlex")]
        return [make_paper("S1", "Strict", source="OpenAlex"), make_paper("L1", "Looser", source="OpenAlex")]
    monkeypatch.setattr(s, "_openalex_request", fake_request)
    parsed = ParsedQuery(keywords=["x"], concepts=[["a"], ["b"], ["c"]])
    papers = await s._openalex_intersection(None, parsed, 50)
    assert [p.paper_id for p in papers] == ["S1", "L1"]  # 严格交集排前面，放宽后的补在后面
    assert queries == ["(a) AND (b) AND (c)", "(a) AND (b)"]


# ── 标题清洗 ──────────────────────────────────────────────────────────────────

def test_clean_title_decodes_entities_and_inline_tags():
    from services.search_service import _clean_title
    assert _clean_title("Wood Carbon Sponge/SiO&lt;sub&gt;2&lt;/sub&gt; Aerogel") == "Wood Carbon Sponge/SiO2 Aerogel"
    assert _clean_title("<jats:title>Growth of <jats:italic>E. coli</jats:italic></jats:title>") == "Growth of E. coli"
    assert _clean_title("Rock &amp; Roll") == "Rock & Roll"


def test_clean_title_cuts_citation_tail_so_duplicates_merge():
    from services.search_service import _clean_title, _sanitize_paper
    junk = "Conformance testing of network simulators based on metamorphic testing technique,” in Formal Techniques for Distributed Systems"
    assert _clean_title(junk) == "Conformance testing of network simulators based on metamorphic testing technique"
    assert _clean_title('The word "cloud" in computing') == 'The word "cloud" in computing'
    good = make_paper("W1", "Conformance Testing of Network Simulators Based on Metamorphic Testing Technique",
                      source="OpenAlex", citations=29)
    bad = make_paper("W2", junk, source="OpenAlex")
    assert len(deduplicate([_sanitize_paper(good), _sanitize_paper(bad)])) == 1


# ── 沿引用链扩展 ──────────────────────────────────────────────────────────────

def _oa_item(wid, title, cites=0, doi=None):
    return {"id": f"https://openalex.org/{wid}", "title": title, "cited_by_count": cites,
            "doi": f"https://doi.org/{doi}" if doi else None, "authorships": []}


async def test_expand_citations_ranks_co_cited_refs_and_skips_known(monkeypatch, stub_httpx):
    from services import search_service as s
    sent = []

    async def fake_get(client, params):
        sent.append(params)
        f = params["filter"]
        if f.startswith("openalex:W1"):          # 种子的参考文献列表
            return [{"id": "https://openalex.org/W1", "referenced_works": [
                "https://openalex.org/R1", "https://openalex.org/R2", "https://openalex.org/R3"]}]
        if f.startswith("doi:"):
            return [{"id": "https://openalex.org/W2", "referenced_works": ["https://openalex.org/R2"]}]
        if f.startswith("cites:"):
            return [_oa_item("C1", "Citing paper"), _oa_item("W1", "Seed itself")]
        if f.startswith("openalex:"):            # 参考文献的元数据
            return [_oa_item("R1", "Ref one", cites=900), _oa_item("R2", "Ref two", cites=5),
                    _oa_item("R3", "Already Known", cites=50)]
        raise AssertionError(f)

    monkeypatch.setattr(s, "OPENALEX_API_KEY", "k")
    monkeypatch.setattr(s, "_openalex_get", fake_get)
    seeds = [make_paper("W1", "Seed", source="OpenAlex"), make_paper("2101.00001", "Seed two", doi="10.1/two")]
    known = seeds + [make_paper("X9", "already known.", source="CrossRef")]
    parsed = ParsedQuery(keywords=["rl", "missile guidance"], date_from="2020-01-01")
    papers = await s.expand_citations(seeds, known, parsed)
    assert [p.paper_id for p in papers] == ["R2", "R1", "C1"]  # R2 被两篇种子引用排第一；已有的、种子本身不要
    cites = next(p for p in sent if p["filter"].startswith("cites:"))
    assert cites["filter"] == "cites:W1|W2,is_retracted:false,publication_date:>2020-01-01"
    assert cites["search"] == 'rl OR "missile guidance"'


async def test_expand_citations_needs_key_and_seeds(monkeypatch):
    from services import search_service as s
    monkeypatch.setattr(s, "OPENALEX_API_KEY", "")
    assert await s.expand_citations([make_paper("W1", "Seed")], [], ParsedQuery(keywords=["x"])) == []
    monkeypatch.setattr(s, "OPENALEX_API_KEY", "k")
    assert await s.expand_citations([], [], ParsedQuery(keywords=["x"])) == []


# ── 摘要清洗、各源解析 ────────────────────────────────────────────────────────

class _FakeResp:
    def __init__(self, json_data=None, text=""):
        self._json, self.text, self.status_code, self.headers = json_data, text, 200, {}

    def raise_for_status(self):
        pass

    def json(self):
        return self._json


def _route_http(monkeypatch, routes: dict):
    """按 URL 片段返回假响应，不联网。"""
    from services import search_service as s

    class DummyClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False

    async def fake_get(client, url, **kwargs):
        for frag, resp in routes.items():
            if frag in url:
                return resp
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(s.httpx, "AsyncClient", DummyClient)
    monkeypatch.setattr(s, "_get_with_retry", fake_get)


def test_clean_abstract_turns_headings_into_labels_and_drops_tags():
    from services.search_service import _clean_abstract
    epmc = "<h4>Introduction</h4>Guide RNAs bind DNA.<h4>Methods</h4>We used SiO<sub>2</sub> and <i>E. coli</i>."
    assert _clean_abstract(epmc) == "Introduction: Guide RNAs bind DNA. Methods: We used SiO2 and E. coli."
    crossref = "<jats:title>Abstract</jats:title><jats:p>MgH<jats:sub>2</jats:sub> releases hydrogen.</jats:p>"
    assert _clean_abstract(crossref) == "MgH2 releases hydrogen."
    assert _clean_abstract("SiO&lt;sub&gt;2&lt;/sub&gt; &amp; TiO2") == "SiO2 & TiO2"


def test_clean_abstract_keeps_comparison_signs():
    from services.search_service import _clean_abstract
    text = "Mortality fell (p < 0.05) in patients aged >65 years and 3<x."
    assert _clean_abstract(text) == text
    assert _clean_abstract("risk &lt; 0.01 and &gt; 2") == "risk < 0.01 and > 2"


def test_sanitize_paper_cleans_abstract():
    from services.search_service import _sanitize_paper
    p = make_paper("E1", "T", source="Europe PMC", abstract="<h4>Background</h4>Text <b>here</b>.")
    assert _sanitize_paper(p).abstract == "Background: Text here."


_PUBMED_XML = """<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID><Article>
<ArticleTitle>Enhanced kinetics of MgH<sub>2</sub> by <i>in situ</i> catalysts</ArticleTitle>
<Abstract>
<AbstractText Label="BACKGROUND">A biotemplated <i>Ni</i> catalyst lowers MgH<sub>2</sub> barriers.</AbstractText>
<AbstractText Label="MATERIALS AND METHODS">We used XRD.</AbstractText>
</Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>"""


async def test_pubmed_keeps_text_after_inline_tags(monkeypatch):
    from services import search_service as s
    _route_http(monkeypatch, {
        "esearch": _FakeResp({"esearchresult": {"idlist": ["1"]}}),
        "efetch": _FakeResp(text=_PUBMED_XML),
    })
    [p] = await s._search_pubmed(ParsedQuery(keywords=["MgH2"]), 10)
    assert p.title == "Enhanced kinetics of MgH2 by in situ catalysts"
    assert p.abstract == ("Background: A biotemplated Ni catalyst lowers MgH2 barriers. "
                          "Materials and methods: We used XRD.")


def _crossref_item(doi, license_url=None):
    item = {"DOI": doi, "title": ["Paper " + doi], "URL": f"https://doi.org/{doi}",
            "container-title": ["Journal of Tests"],
            "link": [{"URL": f"https://publisher.example/{doi}.pdf", "content-type": "application/pdf"}]}
    if license_url:
        item["license"] = [{"URL": license_url, "content-version": "vor", "delay-in-days": 0}]
    return item


async def test_crossref_pdf_only_for_open_licenses(monkeypatch):
    from services import search_service as s
    items = [_crossref_item("10.1/open", "http://creativecommons.org/licenses/by/4.0/"),
             _crossref_item("10.1/tdm", "https://www.springer.com/tdm"),
             _crossref_item("10.1/none")]
    _route_http(monkeypatch, {"api.crossref.org": _FakeResp({"message": {"items": items}})})
    papers = {p.doi: p for p in await s._search_crossref(ParsedQuery(keywords=["x"]), 10)}
    assert papers["10.1/open"].pdf_url == "https://publisher.example/10.1/open.pdf"
    assert papers["10.1/tdm"].pdf_url is None   # 出版社的文本挖掘链接，多半是付费墙
    assert papers["10.1/none"].pdf_url is None
    assert papers["10.1/open"].venue == "Journal of Tests"


# ── 按 DOI 补摘要 ─────────────────────────────────────────────────────────────

def _stub_abstract_stores(monkeypatch, openalex=None, europepmc=None):
    from services import search_service as s
    calls = []

    def store(name, result):
        async def lookup(dois):
            calls.append((name, list(dois)))
            if isinstance(result, Exception):
                raise result
            return result or {}
        return lookup

    monkeypatch.setattr(s, "_abstracts_from_openalex", store("openalex", openalex))
    monkeypatch.setattr(s, "_abstracts_from_europepmc", store("europepmc", europepmc))
    return calls


async def test_backfill_abstracts_fills_by_doi_and_cleans(monkeypatch):
    from services.search_service import backfill_abstracts
    calls = _stub_abstract_stores(monkeypatch, openalex={"10.1/a": "From OpenAlex."},
                                  europepmc={"10.1/b": "<h4>Aims</h4>From <i>EPMC</i>."})
    papers = [make_paper("C1", "A", doi="10.1/A", source="CrossRef"),
              make_paper("C2", "B", doi="10.1/b", source="CrossRef"),
              make_paper("C3", "C", doi="10.1/c", source="CrossRef", abstract="Already here."),
              make_paper("C4", "D", source="CrossRef")]
    out = await backfill_abstracts(papers, "CrossRef", ["bio"])
    assert [p.abstract for p in out] == ["From OpenAlex.", "Aims: From EPMC.", "Already here.", None]
    assert sorted(calls) == [("europepmc", ["10.1/a", "10.1/b"]), ("openalex", ["10.1/a", "10.1/b"])]


async def test_backfill_abstracts_skips_own_store_and_off_domain_epmc(monkeypatch):
    from services.search_service import backfill_abstracts
    calls = _stub_abstract_stores(monkeypatch)
    papers = [make_paper("W1", "A", doi="10.1/a", source="OpenAlex")]
    await backfill_abstracts(papers, "OpenAlex", ["cs"])   # 计算机题不查 Europe PMC，OpenAlex 自己也不再查
    assert calls == []
    await backfill_abstracts(papers, "CrossRef", ["cs"])
    assert [name for name, _ in calls] == ["openalex"]


async def test_backfill_abstracts_survives_a_failing_store(monkeypatch):
    from services.search_service import backfill_abstracts
    _stub_abstract_stores(monkeypatch, openalex=RuntimeError("timeout"), europepmc={"10.1/a": "Rescued."})
    [p] = await backfill_abstracts([make_paper("C1", "A", doi="10.1/a", source="CrossRef")], "CrossRef", None)
    assert p.abstract == "Rescued."


async def test_abstracts_from_openalex_rebuilds_inverted_index(monkeypatch):
    from services import search_service as s
    sent = []

    async def fake_get(client, params):
        sent.append(params)
        return [{"doi": "https://doi.org/10.1/A", "abstract_inverted_index": {"Hello": [0], "world": [1]}},
                {"doi": "https://doi.org/10.1/b", "abstract_inverted_index": None}]

    monkeypatch.setattr(s, "_openalex_get", fake_get)
    assert await _abstracts_from_openalex(["10.1/a", "10.1/b"]) == {"10.1/a": "Hello world"}
    assert sent[0]["filter"] == "doi:10.1/a|10.1/b"


async def test_search_all_sources_backfills_each_source(monkeypatch):
    calls = _stub_abstract_stores(monkeypatch, openalex={"10.1/x": "Filled."})
    source_mocks = {src: AsyncMock(return_value=[]) for src in _ALL_SOURCE_NAMES}
    source_mocks["CrossRef"] = AsyncMock(return_value=[make_paper("C1", "X", doi="10.1/x", source="CrossRef")])
    with patch.dict("services.search_service._SOURCE_FUNCS", source_mocks):
        [p] = await search_all_sources(ParsedQuery(keywords=["x"], domains=["cs"]))
    assert p.abstract == "Filled."


def test_fallback_links_start_with_publisher_and_china_reachable_search():
    from services.pdf_finder_service import generate_fallback_links
    names = [l["name"] for l in generate_fallback_links(make_paper("C1", "Some Title", doi="10.1/x"))]
    assert names[:2] == ["出版社原文", "百度学术"]
    assert "百度学术" in [l["name"] for l in generate_fallback_links(make_paper("C2", "No DOI"))]
