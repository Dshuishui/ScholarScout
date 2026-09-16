import asyncio
import random
import logging
import re
import unicodedata
import xml.etree.ElementTree as ET
import feedparser
import httpx
from models import Paper, ParsedQuery
from services.health_monitor import record_source_result
from config import (
    CORE_API_KEY, NASA_ADS_API_KEY, SERPAPI_KEY, OPENALEX_API_KEY, SEMANTIC_SCHOLAR_HEADERS, POLITE_EMAIL,
)

logger = logging.getLogger(__name__)


def _quoted_or(keywords: list[str]) -> str:
    """把关键词拼成 "a" OR "b" 的布尔查询；多词关键词加引号按短语匹配。"""
    terms = [k.replace('"', "").strip() for k in keywords]
    return " OR ".join(f'"{t}"' if " " in t else t for t in terms if t)


RETRY_STATUS = (429, 502, 503, 504)
RETRY_ATTEMPTS = 3
RETRY_MAX_WAIT = 8.0


async def _get_with_retry(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    """限流 / 上游临时故障时按指数退避重试（2s、4s…，带抖动，上限 8s）。

    有 Retry-After 就听服务端的。多个数据源同时被限流时，抖动能避免重试请求再次撞在一起。
    """
    wait = 2.0
    for attempt in range(RETRY_ATTEMPTS):
        resp = await client.get(url, **kwargs)
        if resp.status_code not in RETRY_STATUS or attempt == RETRY_ATTEMPTS - 1:
            return resp
        try:
            retry_after = float(resp.headers.get("retry-after", ""))
        except ValueError:
            retry_after = 0.0
        delay = min(max(retry_after, wait), RETRY_MAX_WAIT) + random.uniform(0, 0.5)
        logger.debug("%s from %s, retry %d after %.1fs", resp.status_code, url, attempt + 1, delay)
        await asyncio.sleep(delay)
        wait *= 2
    return resp


async def _search_arxiv(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        kw_part = " OR ".join(f'all:"{kw}"' for kw in parsed.keywords)
        search_query = f'({kw_part})'
        if parsed.date_from:
            date_str = parsed.date_from.replace("-", "")
            search_query += f' AND submittedDate:[{date_str}000000 TO *]'
        # 有时间范围也按相关性排：按日期排拿回的是"最新的、沾点边的"，不是最相关的
        sort_by = "relevance"

        async with httpx.AsyncClient(timeout=25) as client:
            resp = await _get_with_retry(
                client,
                "https://export.arxiv.org/api/query",
                params={"search_query": search_query, "max_results": limit,
                        "sortBy": sort_by, "sortOrder": "descending"},
            )
            resp.raise_for_status()

        feed = feedparser.parse(resp.text)
        papers = []
        for entry in feed.entries:
            try:
                arxiv_id = entry.id.split("/abs/")[-1]
                pdf_url = next(
                    (lk.href for lk in entry.get("links", []) if lk.get("type") == "application/pdf"),
                    f"https://arxiv.org/pdf/{arxiv_id}.pdf",
                )
                papers.append(Paper(
                    paper_id=arxiv_id,
                    title=entry.get("title", "").replace("\n", " ").strip(),
                    authors=[a.get("name", "") for a in entry.get("authors", [])],
                    abstract=(entry.get("summary", "") or "").replace("\n", " ").strip() or None,
                    published_date=entry.get("published", "")[:10] or None,
                    doi=None,
                    pdf_url=pdf_url,
                    url=entry.get("id"),
                    source="arXiv",
                    citations=0,
                ))
            except Exception:
                continue
        return papers
    except Exception as e:
        logger.warning("arXiv search error: %s", e)
        return []


async def _search_semantic_scholar(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        query = " ".join(parsed.keywords)
        params = {
            "query": query,
            "limit": limit,
            "fields": "paperId,title,authors,abstract,year,externalIds,openAccessPdf,citationCount,venue,publicationVenue",
        }
        if parsed.date_from:
            params["year"] = f"{parsed.date_from[:4]}-"
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await _get_with_retry(
                client,
                "https://api.semanticscholar.org/graph/v1/paper/search",
                params=params,
                headers=SEMANTIC_SCHOLAR_HEADERS,
            )
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for item in data.get("data", []):
            year = item.get("year")
            doi = (item.get("externalIds") or {}).get("DOI")
            oa = item.get("openAccessPdf") or {}
            venue = (item.get("publicationVenue") or {}).get("name") or item.get("venue") or None
            papers.append(Paper(
                paper_id=item.get("paperId", ""),
                title=item.get("title", ""),
                authors=[a.get("name", "") for a in item.get("authors", [])],
                abstract=item.get("abstract"),
                published_date=f"{year}-01-01" if year else None,
                doi=doi,
                pdf_url=oa.get("url"),
                url=f"https://www.semanticscholar.org/paper/{item.get('paperId', '')}",
                source="Semantic Scholar",
                citations=item.get("citationCount", 0) or 0,
                venue=venue,
            ))
        return papers
    except Exception as e:
        logger.warning("Semantic Scholar search error: %s", e)
        return []


_OPENALEX_SELECT = "id,title,authorships,abstract_inverted_index,publication_date,doi,open_access,cited_by_count,primary_location"


def _openalex_item_to_paper(item: dict) -> Paper:
    doi = (item.get("doi") or "").replace("https://doi.org/", "") or None
    oa = item.get("open_access", {})
    pdf_url = oa.get("oa_url") if oa.get("is_oa") else None
    work_id = item.get("id", "").replace("https://openalex.org/", "")

    abstract = None
    inv = item.get("abstract_inverted_index")
    if inv:
        words: dict[int, str] = {}
        for word, positions in inv.items():
            for pos in positions:
                words[pos] = word
        abstract = " ".join(words[i] for i in sorted(words))

    venue = ((item.get("primary_location") or {}).get("source") or {}).get("display_name")
    return Paper(
        paper_id=work_id,
        title=item.get("title", ""),
        authors=[
            a.get("author", {}).get("display_name", "")
            for a in item.get("authorships", [])[:5]
        ],
        abstract=abstract,
        published_date=item.get("publication_date"),
        doi=doi,
        pdf_url=pdf_url,
        url=item.get("id"),
        source="OpenAlex",
        citations=item.get("cited_by_count", 0) or 0,
        venue=venue,
    )


async def _openalex_request(client: httpx.AsyncClient, search_param: str, query: str,
                            parsed: ParsedQuery, limit: int) -> list[Paper]:
    params = {search_param: query, "per_page": limit, "select": _OPENALEX_SELECT}
    if parsed.date_from:
        params["filter"] = f"publication_date:>{parsed.date_from}"
    if OPENALEX_API_KEY:
        params["api_key"] = OPENALEX_API_KEY
    resp = await _get_with_retry(
        client,
        "https://api.openalex.org/works",
        params=params,
        headers={"User-Agent": f"ScholarScout/1.0 (mailto:{POLITE_EMAIL})"},
    )
    resp.raise_for_status()
    return [_openalex_item_to_paper(it) for it in resp.json().get("results", [])]


def _rrf_fuse(ranked_lists: list[list[Paper]], limit: int, k: int = 10) -> list[Paper]:
    """Reciprocal Rank Fusion：在任一路结果里排得靠前的论文都会排到前面。

    k 取 10 而不是常见的 60：k=60 时"两路都排第 50"（2/110）会压过"只在一路排第 1"（1/61），
    截取前 limit 篇后，语义检索独有的头部结果（如 GPT-3）反而会被挤掉。
    """
    scores: dict[str, float] = {}
    first_seen: dict[str, Paper] = {}
    for papers in ranked_lists:
        for rank, p in enumerate(papers, start=1):
            scores[p.paper_id] = scores.get(p.paper_id, 0.0) + 1.0 / (k + rank)
            first_seen.setdefault(p.paper_id, p)
    ordered = sorted(scores, key=lambda pid: scores[pid], reverse=True)
    return [first_seen[pid] for pid in ordered[:limit]]


async def _search_openalex(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """关键词检索 + （配置了 API key 时）语义检索，RRF 融合。

    关键词用 OR 连接：空格拼接会被当成"所有词都要出现"，同义词一多经典论文就被漏掉
    （实测潜在扩散模型、思维链由"前 50 条没有"变成排第 1）。
    语义检索（OpenAlex 用 GTE-large 对标题+摘要做了向量化）补上用词不同的论文：
    实测 GPT-3 从第 16 升到第 1；但它会漏掉思维链（关键词检索排第 1），所以两路融合而不是替换。
    语义检索每次多一次计费调用，无 key 时每天只有 0.1 美元额度，所以只在配置 key 后启用。
    """
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            keyword_task = _openalex_request(client, "search", _quoted_or(parsed.keywords), parsed, limit)
            if not OPENALEX_API_KEY:
                return await keyword_task
            keyword_res, semantic_res = await asyncio.gather(
                keyword_task,
                _openalex_request(client, "search.semantic", ", ".join(parsed.keywords), parsed, limit),
                return_exceptions=True,
            )
        lists = [r for r in (keyword_res, semantic_res) if isinstance(r, list)]
        for r in (keyword_res, semantic_res):
            if isinstance(r, Exception):
                logger.warning("OpenAlex sub-search error: %s", r)
        return _rrf_fuse(lists, limit)
    except Exception as e:
        logger.warning("OpenAlex search error: %s", e)
        return []


async def _search_pubmed(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        search_params: dict = {
            "db": "pubmed",
            "term": " OR ".join(parsed.keywords),
            "retmax": limit,
            "retmode": "json",
            "sort": "relevance",
        }
        if parsed.date_from:
            search_params["datetype"] = "pdat"
            search_params["mindate"] = parsed.date_from[:4]
            search_params["maxdate"] = "3000"

        headers = {"User-Agent": "ScholarScout/1.0 (mailto:sasakinakamura9@gmail.com)"}
        async with httpx.AsyncClient(timeout=20) as client:
            search_resp = await _get_with_retry(
                client,
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                params=search_params, headers=headers,
            )
            search_resp.raise_for_status()
            ids = search_resp.json().get("esearchresult", {}).get("idlist", [])

        if not ids:
            return []

        async with httpx.AsyncClient(timeout=20) as client:
            fetch_resp = await _get_with_retry(
                client,
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
                params={"db": "pubmed", "id": ",".join(ids), "retmode": "xml", "rettype": "abstract"},
                headers=headers,
            )
            fetch_resp.raise_for_status()

        root = ET.fromstring(fetch_resp.text)
        papers = []
        for article in root.findall(".//PubmedArticle"):
            try:
                medline = article.find("MedlineCitation")
                art = medline.find("Article")

                pmid = medline.findtext("PMID", "")
                title = (art.findtext("ArticleTitle") or "").strip()
                if not title:
                    continue

                abstract = " ".join(
                    (p.text or "") for p in art.findall(".//AbstractText")
                ).strip() or None

                authors = []
                for author in art.findall(".//Author"):
                    last = author.findtext("LastName", "")
                    initials = author.findtext("Initials", "")
                    if last:
                        authors.append(f"{last} {initials}".strip())

                pub_date = medline.find(".//PubDate")
                year = pub_date.findtext("Year") if pub_date is not None else None
                published_date = f"{year}-01-01" if year else None

                doi = None
                for loc in art.findall(".//ELocationID"):
                    if loc.get("EIdType") == "doi":
                        doi = loc.text
                        break

                pmc_id = None
                for id_elem in article.findall(".//ArticleId"):
                    if id_elem.get("IdType") == "pmc":
                        pmc_id = id_elem.text
                        break
                pdf_url = f"https://www.ncbi.nlm.nih.gov/pmc/articles/{pmc_id}/pdf/" if pmc_id else None

                journal = art.find("Journal")
                venue = journal.findtext("Title") if journal is not None else None

                papers.append(Paper(
                    paper_id=f"pubmed_{pmid}",
                    title=title,
                    authors=authors,
                    abstract=abstract,
                    published_date=published_date,
                    doi=doi,
                    pdf_url=pdf_url,
                    url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                    source="PubMed",
                    citations=0,
                    venue=venue,
                ))
            except Exception:
                continue
        return papers
    except Exception as e:
        logger.warning("PubMed search error: %s", e)
        return []


async def _search_core(parsed: ParsedQuery, limit: int) -> list[Paper]:
    if not CORE_API_KEY:
        return []
    try:
        body: dict = {"q": " ".join(parsed.keywords), "limit": limit}
        if parsed.date_from:
            body["filters"] = {"yearPublished": {"gte": int(parsed.date_from[:4])}}

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.core.ac.uk/v3/search/works",
                json=body,
                headers={"Authorization": f"Bearer {CORE_API_KEY}"},
            )
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for item in data.get("results", []):
            work_id = str(item.get("id", ""))
            year = item.get("yearPublished")
            authors = [a.get("name", "") for a in (item.get("authors") or [])]
            pdf_url = item.get("downloadUrl") or (
                (item.get("sourceFulltextUrls") or [None])[0]
            )
            papers.append(Paper(
                paper_id=f"core_{work_id}",
                title=(item.get("title") or "").strip(),
                authors=authors,
                abstract=item.get("abstract"),
                published_date=f"{year}-01-01" if year else None,
                doi=item.get("doi"),
                pdf_url=pdf_url,
                url=f"https://core.ac.uk/works/{work_id}",
                source="CORE",
                citations=0,
            ))
        return papers
    except Exception as e:
        logger.warning("CORE search error: %s", e)
        return []


async def _search_inspire(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """INSPIRE-HEP：高能物理 / 粒子物理 / 理论物理，无需 Key"""
    try:
        # INSPIRE 里空格是 AND；按 mostrecent 排会把引力波首次探测这类经典论文挤出前 50，
        # 改成 or 连接 + 默认相关性排序后排第 12
        kw = " or ".join(f'"{k}"' for k in parsed.keywords)
        query = f"({kw})"
        if parsed.date_from:
            query += f" AND date>{parsed.date_from[:4]}"

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await _get_with_retry(
                client,
                "https://inspirehep.net/api/literature",
                params={"q": query, "size": limit,
                        "fields": "titles,authors,abstracts,earliest_date,dois,arxiv_eprints"},
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for hit in data.get("hits", {}).get("hits", []):
            meta = hit.get("metadata", {})
            inspire_id = str(hit.get("id", ""))
            title = (meta.get("titles") or [{}])[0].get("title", "").strip()
            if not title:
                continue
            abstract_val = (meta.get("abstracts") or [{}])[0].get("value", "") or None
            authors = [a.get("full_name", "") for a in (meta.get("authors") or [])[:10]]
            doi = ((meta.get("dois") or [{}])[0].get("value") or None)
            arxiv_id = ((meta.get("arxiv_eprints") or [{}])[0].get("value") or None)
            pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else None
            published_date = (meta.get("earliest_date") or "")[:10] or None

            pub_info = (meta.get("publication_info") or [{}])[0]
            venue = pub_info.get("journal_title") or None

            papers.append(Paper(
                paper_id=f"inspire_{inspire_id}",
                title=title,
                authors=authors,
                abstract=abstract_val,
                published_date=published_date,
                doi=doi,
                pdf_url=pdf_url,
                url=f"https://inspirehep.net/literature/{inspire_id}",
                source="INSPIRE-HEP",
                citations=0,
                venue=venue,
            ))
        return papers
    except Exception as e:
        logger.warning("INSPIRE-HEP search error: %s", e)
        return []


async def _search_europepmc(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """Europe PMC：生命科学 / 生化 / 医学，无需 Key，同时收录 bioRxiv/medRxiv 预印本"""
    try:
        kw = "(" + " OR ".join(parsed.keywords) + ")"
        query = kw
        if parsed.date_from:
            query += f" AND FIRST_PDATE:[{parsed.date_from[:4]} TO *]"

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await _get_with_retry(
                client,
                "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                params={"query": query, "pageSize": limit,
                        "format": "json", "resultType": "core"},
            )
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for item in data.get("resultList", {}).get("result", []):
            title = (item.get("title") or "").strip()
            if not title:
                continue
            pmcid = item.get("pmcid")
            pdf_url = None
            if pmcid:
                for fu in (item.get("fullTextUrlList") or {}).get("fullTextUrl", []):
                    if fu.get("availabilityCode") == "OA" and "pdf" in fu.get("url", "").lower():
                        pdf_url = fu["url"]
                        break
                if not pdf_url:
                    pdf_url = f"https://europepmc.org/backend/ptpmcrender.fcgi?accid={pmcid}&blobtype=pdf"

            papers.append(Paper(
                paper_id=f"epmc_{item.get('id', '')}",
                title=title,
                authors=[a.get("fullName", "") for a in
                         (item.get("authorList") or {}).get("author", [])],
                abstract=item.get("abstractText"),
                published_date=item.get("firstPublicationDate"),
                doi=item.get("doi"),
                pdf_url=pdf_url,
                url=f"https://europepmc.org/article/{item.get('source','')}/{item.get('id','')}",
                source="Europe PMC",
                citations=item.get("citedByCount", 0) or 0,
                venue=item.get("journalTitle") or None,
            ))
        return papers
    except Exception as e:
        logger.warning("Europe PMC search error: %s", e)
        return []


async def _search_nasa_ads(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """NASA ADS：天文 / 天体物理 / 地球科学，需免费注册 Key"""
    if not NASA_ADS_API_KEY:
        return []
    try:
        kw = "(" + " OR ".join(parsed.keywords) + ")"
        query = kw
        if parsed.date_from:
            query += f" pubdate:[{parsed.date_from[:4]} TO 9999]"

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await _get_with_retry(
                client,
                "https://api.adsabs.harvard.edu/v1/search/query",
                params={"q": query, "rows": limit,
                        "fl": "title,author,abstract,pubdate,doi,identifier,bibcode,pub",
                        "sort": "score desc"},
                headers={"Authorization": f"Bearer {NASA_ADS_API_KEY}"},
            )
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for doc in data.get("response", {}).get("docs", []):
            titles = doc.get("title") or []
            title = titles[0].strip() if titles else ""
            if not title:
                continue
            doi = ((doc.get("doi") or [None])[0])
            # 从 identifier 里找 arXiv ID 构造 PDF 链接
            arxiv_id = next(
                (i.replace("arXiv:", "") for i in (doc.get("identifier") or []) if i.startswith("arXiv:")),
                None,
            )
            pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else None
            bibcode = doc.get("bibcode", "")
            pubdate = (doc.get("pubdate") or "")[:7]  # "2023-01"
            published_date = f"{pubdate}-01" if len(pubdate) == 7 else None

            papers.append(Paper(
                paper_id=f"ads_{bibcode}",
                title=title,
                authors=doc.get("author") or [],
                abstract=doc.get("abstract"),
                published_date=published_date,
                doi=doi,
                pdf_url=pdf_url,
                url=f"https://ui.adsabs.harvard.edu/abs/{bibcode}",
                source="NASA ADS",
                citations=0,
                venue=doc.get("pub") or None,
            ))
        return papers
    except Exception as e:
        logger.warning("NASA ADS search error: %s", e)
        return []


async def _search_crossref(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """CrossRef：1.5亿+ 文献元数据，无需 Key，覆盖人文 / 工程 / 自然科学"""
    try:
        params: dict = {
            "query": " ".join(parsed.keywords),
            "rows": limit,
            "mailto": POLITE_EMAIL,
            "select": "DOI,title,author,published-print,published-online,abstract,is-referenced-by-count,URL,link",
        }
        if parsed.date_from:
            params["filter"] = f"from-pub-date:{parsed.date_from[:4]}"

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await _get_with_retry(
                client,
                "https://api.crossref.org/works",
                params=params,
                headers={"User-Agent": f"ScholarScout/1.0 (mailto:{POLITE_EMAIL})"},
            )
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for item in data.get("message", {}).get("items", []):
            titles = item.get("title") or []
            title = titles[0].strip() if titles else ""
            if not title:
                continue

            doi = item.get("DOI")

            # 日期：优先 published-print，其次 published-online
            pub_date = None
            for date_key in ("published-print", "published-online", "created"):
                parts_wrap = (item.get(date_key) or {}).get("date-parts", [[]])
                if parts_wrap and parts_wrap[0]:
                    parts = parts_wrap[0]
                    year = parts[0] if len(parts) > 0 else None
                    month = parts[1] if len(parts) > 1 else 1
                    day = parts[2] if len(parts) > 2 else 1
                    if year:
                        pub_date = f"{year}-{month:02d}-{day:02d}"
                        break

            authors = []
            for a in (item.get("author") or [])[:10]:
                given = a.get("given", "")
                family = a.get("family", "")
                name = f"{given} {family}".strip() if given else family
                if name:
                    authors.append(name)

            # 摘要去除 JATS XML 标签
            abstract_raw = item.get("abstract") or ""
            abstract: str | None = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", abstract_raw)).strip() or None

            # 从 link 数组找 PDF
            pdf_url = None
            for link in (item.get("link") or []):
                if "pdf" in (link.get("content-type") or "").lower():
                    pdf_url = link.get("URL")
                    break

            url = item.get("URL") or (f"https://doi.org/{doi}" if doi else None)
            paper_id = f"crossref_{doi.replace('/', '_')}" if doi else f"crossref_{abs(hash(title))}"

            venue = (item.get("container-title") or [None])[0]
            papers.append(Paper(
                paper_id=paper_id,
                title=title,
                authors=authors,
                abstract=abstract,
                published_date=pub_date,
                doi=doi,
                pdf_url=pdf_url,
                url=url,
                source="CrossRef",
                citations=item.get("is-referenced-by-count", 0) or 0,
                venue=venue,
            ))
        return papers
    except Exception as e:
        logger.warning("CrossRef search error: %s", e)
        return []


async def _search_google_scholar_serpapi(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """Google Scholar via SerpAPI（备用方案）。"""
    if not SERPAPI_KEY:
        return []
    try:
        params: dict = {
            "engine": "google_scholar",
            "q": " ".join(parsed.keywords),
            "api_key": SERPAPI_KEY,
            "num": min(limit, 20),
        }
        if parsed.date_from:
            params["as_ylo"] = parsed.date_from[:4]
        if parsed.date_to:
            params["as_yhi"] = parsed.date_to[:4]

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get("https://serpapi.com/search.json", params=params)
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for item in data.get("organic_results", []):
            title = (item.get("title") or "").strip()
            if not title:
                continue
            pub_info = item.get("publication_info") or {}
            author_list = pub_info.get("authors") or []
            if author_list:
                authors = [a.get("name", "") for a in author_list if a.get("name")]
            else:
                summary = pub_info.get("summary", "")
                authors = [p.strip() for p in summary.split("-")[0].split(",")] if summary else []
            summary = pub_info.get("summary", "")
            year_match = re.search(r"\b(19|20)\d{2}\b", summary)
            published_date = f"{year_match.group()}-01-01" if year_match else None
            pdf_url = None
            for res in (item.get("resources") or []):
                if (res.get("file_format") or "").upper() == "PDF":
                    pdf_url = res.get("link")
                    break
            citations = (item.get("inline_links") or {}).get("cited_by", {}).get("total", 0) or 0
            papers.append(Paper(
                paper_id=f"gs_{item.get('result_id', abs(hash(title)))}",
                title=title,
                authors=authors,
                abstract=item.get("snippet"),
                published_date=published_date,
                doi=None,
                pdf_url=pdf_url,
                url=item.get("link"),
                source="Google Scholar",
                citations=citations,
            ))
        return papers
    except Exception as e:
        logger.warning("Google Scholar (SerpAPI) error: %s", e)
        return []


async def _search_google_scholar(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """Google Scholar 只走 SerpAPI。

    服务器在国内，直连 scholar.google.com 被墙；以前用 scholarly + 代理抓取，
    代理一失效每次搜索都要先卡 15 秒，还会留下后台重试线程。SerpAPI 可直连。
    """
    return await _search_google_scholar_serpapi(parsed, limit)


async def enhance_with_unpaywall(papers: list[Paper]) -> list[Paper]:
    """为有 DOI 但无 PDF 的论文查询 Unpaywall，尝试补全开放获取 PDF 链接。"""
    to_enhance = [p for p in papers if p.doi and not p.pdf_url]
    if not to_enhance:
        return papers

    sem = asyncio.Semaphore(5)

    async def fetch_pdf(paper: Paper) -> tuple[str, str | None]:
        async with sem:
            try:
                async with httpx.AsyncClient(timeout=6) as client:
                    resp = await client.get(
                        f"https://api.unpaywall.org/v2/{paper.doi}",
                        params={"email": POLITE_EMAIL},
                    )
                    if resp.status_code == 200:
                        loc = resp.json().get("best_oa_location") or {}
                        pdf_url = loc.get("url_for_pdf") or loc.get("url")
                        return paper.paper_id, pdf_url
            except Exception:
                pass
        return paper.paper_id, None

    results = await asyncio.gather(*[fetch_pdf(p) for p in to_enhance])
    pdf_map = {pid: url for pid, url in results if url}

    return [
        p.model_copy(update={"pdf_url": pdf_map[p.paper_id]}) if p.paper_id in pdf_map else p
        for p in papers
    ]


def _clean_title(title: str) -> str:
    """去除 HTML/XML 标签（如 CrossRef 返回的 JATS 标签），压缩空白。"""
    t = re.sub(r"<[^>]+>", " ", title)
    return re.sub(r"\s+", " ", t).strip()


def _clean_authors(authors: list[str]) -> list[str]:
    """过滤空字符串和纯空白作者名。"""
    return [a.strip() for a in authors if a and a.strip()]


def _normalize_pdf_url(url: str | None) -> str | None:
    """将已知来源的落地页 URL 转换为 PDF 直链。"""
    if not url:
        return url
    # arXiv 摘要页 → PDF（保留版本号）
    m = re.match(r"https?://(?:export\.)?arxiv\.org/abs/(.+?)/?$", url)
    if m:
        return f"https://arxiv.org/pdf/{m.group(1)}"
    # bioRxiv / medRxiv 内容页 → full PDF（去掉查询参数再拼）
    if re.match(r"https?://(?:www\.)?(?:bio|med)rxiv\.org/content/", url) and not url.endswith(".pdf"):
        base = url.split("?")[0].split("#")[0]
        return base + ".full.pdf"
    return url


def _sanitize_paper(p: Paper) -> Paper:
    """清洗 title HTML 标签、过滤空作者名、规范化 PDF URL。"""
    clean_title = _clean_title(p.title)
    clean_authors = _clean_authors(p.authors)
    clean_pdf_url = _normalize_pdf_url(p.pdf_url)
    updates: dict = {}
    if clean_title != p.title:
        updates["title"] = clean_title or p.title
    if clean_authors != p.authors:
        updates["authors"] = clean_authors
    if clean_pdf_url != p.pdf_url:
        updates["pdf_url"] = clean_pdf_url
    return p.model_copy(update=updates) if updates else p


def _normalize_title(title: str) -> str:
    """标题规范化：Unicode 归一化 → ASCII → 小写 → 去首尾标点 → 压缩空白。

    对纯非拉丁标题（中文、希腊字母等），ASCII 归一化会得到空串。此时回退到
    NFKC 归一化后的原始标题，避免 deduplicate 因空 key 而整篇丢弃论文。
    """
    t = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    t = t.lower().rstrip(".,;:!?。，；：！？").strip()
    t = re.sub(r"\s+", " ", t)
    if t:
        return t
    fallback = unicodedata.normalize("NFKC", title).lower().rstrip(".,;:!?。，；：！？").strip()
    return re.sub(r"\s+", " ", fallback)


def _merge(existing: Paper, newcomer: Paper) -> Paper:
    """用后来的论文补全现有版本的空字段，引用数取最大值，摘要取更长的，source_links 累积。"""
    abstract = existing.abstract
    if newcomer.abstract and (not abstract or len(newcomer.abstract) > len(abstract)):
        abstract = newcomer.abstract

    # 累积来源链接：已有的 + newcomer 的（同源不重复）
    existing_links: list[dict] = list(existing.source_links) if existing.source_links else (
        [{"source": existing.source, "url": existing.url}] if existing.url else []
    )
    existing_sources = {l["source"] for l in existing_links}
    if newcomer.url and newcomer.source not in existing_sources:
        source_links = existing_links + [{"source": newcomer.source, "url": newcomer.url}]
    else:
        source_links = existing_links

    return existing.model_copy(update={
        "pdf_url":      existing.pdf_url or newcomer.pdf_url,
        "abstract":     abstract,
        "citations":    max(existing.citations, newcomer.citations),
        "doi":          existing.doi or newcomer.doi,
        "source_links": source_links,
        "venue":        existing.venue or newcomer.venue,
    })


def deduplicate(papers: list[Paper]) -> list[Paper]:
    """去重并合并：DOI 精确匹配优先，标题规范化兜底；重复时合并最优字段而非丢弃。"""
    seen_dois: dict[str, int] = {}    # doi → result 中的下标
    seen_titles: dict[str, int] = {}  # 规范化标题 → result 中的下标
    result: list[Paper] = []

    for p in papers:
        doi_key = p.doi.lower().strip() if p.doi else None
        title_key = _normalize_title(p.title)
        if not title_key:
            continue

        # DOI 命中 → 合并
        if doi_key and doi_key in seen_dois:
            idx = seen_dois[doi_key]
            result[idx] = _merge(result[idx], p)
            if title_key not in seen_titles:
                seen_titles[title_key] = idx
            continue

        # 标题命中 → 合并
        if title_key in seen_titles:
            idx = seen_titles[title_key]
            result[idx] = _merge(result[idx], p)
            if doi_key and doi_key not in seen_dois:
                seen_dois[doi_key] = idx
            continue

        # 新论文 → 初始化 source_links 后加入
        idx = len(result)
        if not p.source_links and p.url:
            p = p.model_copy(update={"source_links": [{"source": p.source, "url": p.url}]})
        result.append(p)
        if doi_key:
            seen_dois[doi_key] = idx
        seen_titles[title_key] = idx

    return result


_SOURCE_FUNCS: dict = {
    "arXiv":            _search_arxiv,
    "Semantic Scholar": _search_semantic_scholar,
    "OpenAlex":         _search_openalex,
    "PubMed":           _search_pubmed,
    "Europe PMC":       _search_europepmc,
    "INSPIRE-HEP":      _search_inspire,
    "CrossRef":         _search_crossref,
    "CORE":             _search_core,
    "NASA ADS":         _search_nasa_ads,
    "Google Scholar":   _search_google_scholar,
}


# 专科数据源只覆盖特定领域；其余（arXiv、Semantic Scholar、OpenAlex、CrossRef、CORE、Google Scholar）是综合库。
# 实测搜纯计算机的题目时，PubMed + Europe PMC 贡献了候选池的一半，基本都是噪音。
KNOWN_DOMAINS = {"cs", "math", "physics", "astro", "bio", "med", "chem", "eng", "social", "humanities"}
_SOURCE_DOMAINS: dict[str, set[str]] = {
    "PubMed":      {"bio", "med", "chem", "social"},
    "Europe PMC":  {"bio", "med", "chem", "social"},
    "INSPIRE-HEP": {"physics", "astro"},
    "NASA ADS":    {"physics", "astro"},
}


def _source_matches_domains(name: str, domains: list[str] | None) -> bool:
    """领域未知、为空或含无法识别的值时一律不过滤，宁可多查不能漏查。"""
    if not domains or not set(domains) <= KNOWN_DOMAINS:
        return True
    covered = _SOURCE_DOMAINS.get(name)
    return covered is None or bool(covered & set(domains))


def get_source_names(sources: list[str] | None = None, domains: list[str] | None = None) -> list[str]:
    """Return the list of source names that will actually be searched."""
    names = list(_SOURCE_FUNCS.keys()) if not sources else [k for k in _SOURCE_FUNCS if k in sources]
    routed = [n for n in names if _source_matches_domains(n, domains)]
    # 用户手动只勾了专科库（比如只勾 PubMed）时，按领域过滤会一个都不剩：尊重用户的选择
    return routed or names


async def search_all_sources(
    parsed: ParsedQuery,
    limit_per_source: int = 10,
    sources: list[str] | None = None,
    on_source_done=None,  # async callable(name: str, count: int) | None
) -> list[Paper]:
    funcs = {name: _SOURCE_FUNCS[name] for name in get_source_names(sources, parsed.domains)}

    async def run_source(name: str, fn) -> list[Paper]:
        papers = await fn(parsed, limit_per_source)
        record_source_result(name, len(papers))
        if on_source_done:
            await on_source_done(name, len(papers))
        return papers

    results = await asyncio.gather(*(run_source(name, fn) for name, fn in funcs.items()))
    all_papers = [_sanitize_paper(p) for source_results in results for p in source_results]
    return deduplicate(all_papers)
