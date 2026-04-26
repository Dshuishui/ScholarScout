import asyncio
import re
import unicodedata
import xml.etree.ElementTree as ET
import feedparser
import httpx
from models import Paper, ParsedQuery
from config import CORE_API_KEY, NASA_ADS_API_KEY, SERPAPI_KEY, POLITE_EMAIL


async def _search_arxiv(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        kw_part = " OR ".join(f'all:"{kw}"' for kw in parsed.keywords)
        if parsed.date_from:
            date_str = parsed.date_from.replace("-", "")
            search_query = f'({kw_part}) AND submittedDate:[{date_str}000000 TO *]'
            sort_by = "submittedDate"
        else:
            search_query = f'({kw_part})'
            sort_by = "relevance"

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                "http://export.arxiv.org/api/query",
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
        print(f"arXiv search error: {e}")
        return []


async def _search_semantic_scholar(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        query = " ".join(parsed.keywords)
        params = {
            "query": query,
            "limit": limit,
            "fields": "paperId,title,authors,abstract,year,externalIds,openAccessPdf,citationCount",
        }
        if parsed.date_from:
            params["year"] = f"{parsed.date_from[:4]}-"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.semanticscholar.org/graph/v1/paper/search", params=params
            )
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for item in data.get("data", []):
            year = item.get("year")
            doi = (item.get("externalIds") or {}).get("DOI")
            oa = item.get("openAccessPdf") or {}
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
            ))
        return papers
    except Exception as e:
        print(f"Semantic Scholar search error: {e}")
        return []


async def _search_openalex(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        params = {
            "search": " ".join(parsed.keywords),
            "per_page": limit,
            "select": "id,title,authorships,abstract_inverted_index,publication_date,doi,open_access,cited_by_count",
        }
        if parsed.date_from:
            params["filter"] = f"publication_date:>{parsed.date_from}"

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                "https://api.openalex.org/works",
                params=params,
                headers={"User-Agent": "ScholarScout/1.0 (mailto:sasakinakamura9@gmail.com)"},
            )
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for item in data.get("results", []):
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

            papers.append(Paper(
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
            ))
        return papers
    except Exception as e:
        print(f"OpenAlex search error: {e}")
        return []


async def _search_pubmed(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        search_params: dict = {
            "db": "pubmed",
            "term": " ".join(parsed.keywords),
            "retmax": limit,
            "retmode": "json",
            "sort": "date",
        }
        if parsed.date_from:
            search_params["datetype"] = "pdat"
            search_params["mindate"] = parsed.date_from[:4]
            search_params["maxdate"] = "3000"

        headers = {"User-Agent": "ScholarScout/1.0 (mailto:sasakinakamura9@gmail.com)"}
        async with httpx.AsyncClient(timeout=20) as client:
            search_resp = await client.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                params=search_params, headers=headers,
            )
            search_resp.raise_for_status()
            ids = search_resp.json().get("esearchresult", {}).get("idlist", [])

        if not ids:
            return []

        async with httpx.AsyncClient(timeout=20) as client:
            fetch_resp = await client.get(
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
                ))
            except Exception:
                continue
        return papers
    except Exception as e:
        print(f"PubMed search error: {e}")
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
        print(f"CORE search error: {e}")
        return []


async def _search_inspire(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """INSPIRE-HEP：高能物理 / 粒子物理 / 理论物理，无需 Key"""
    try:
        kw = " ".join(parsed.keywords)
        query = f"({kw})"
        if parsed.date_from:
            query += f" AND date>{parsed.date_from[:4]}"

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                "https://inspirehep.net/api/literature",
                params={"q": query, "size": limit, "sort": "mostrecent",
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
            ))
        return papers
    except Exception as e:
        print(f"INSPIRE-HEP search error: {e}")
        return []


async def _search_europepmc(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """Europe PMC：生命科学 / 生化 / 医学，无需 Key，同时收录 bioRxiv/medRxiv 预印本"""
    try:
        kw = " ".join(parsed.keywords)
        query = kw
        if parsed.date_from:
            query += f" AND FIRST_PDATE:[{parsed.date_from[:4]} TO *]"

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
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
            ))
        return papers
    except Exception as e:
        print(f"Europe PMC search error: {e}")
        return []


async def _search_nasa_ads(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """NASA ADS：天文 / 天体物理 / 地球科学，需免费注册 Key"""
    if not NASA_ADS_API_KEY:
        return []
    try:
        kw = " ".join(parsed.keywords)
        query = kw
        if parsed.date_from:
            query += f" pubdate:[{parsed.date_from[:4]} TO 9999]"

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(
                "https://api.adsabs.harvard.edu/v1/search/query",
                params={"q": query, "rows": limit,
                        "fl": "title,author,abstract,pubdate,doi,identifier,bibcode",
                        "sort": "date desc"},
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
            ))
        return papers
    except Exception as e:
        print(f"NASA ADS search error: {e}")
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
            resp = await client.get(
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
            ))
        return papers
    except Exception as e:
        print(f"CrossRef search error: {e}")
        return []


async def _search_google_scholar(parsed: ParsedQuery, limit: int) -> list[Paper]:
    """Google Scholar via SerpAPI：综合覆盖，需服务器配置 SERPAPI_KEY。"""
    if not SERPAPI_KEY:
        return []
    try:
        params: dict = {
            "engine": "google_scholar",
            "q": " ".join(parsed.keywords),
            "api_key": SERPAPI_KEY,
            "num": min(limit, 20),  # SerpAPI 单页最多 20 条
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

            result_id = item.get("result_id", "")

            # 作者：优先 publication_info.authors，其次解析 summary
            pub_info = item.get("publication_info") or {}
            author_list = pub_info.get("authors") or []
            if author_list:
                authors = [a.get("name", "") for a in author_list if a.get("name")]
            else:
                # summary 格式通常是 "A, B - 2023 - Journal"
                summary = pub_info.get("summary", "")
                authors = [p.strip() for p in summary.split("-")[0].split(",")] if summary else []

            # 年份：从 summary 里提取 4 位数字
            published_date = None
            summary = pub_info.get("summary", "")
            year_match = re.search(r"\b(19|20)\d{2}\b", summary)
            if year_match:
                published_date = f"{year_match.group()}-01-01"

            # PDF 链接：从 resources 数组里找 PDF 格式
            pdf_url = None
            for res in (item.get("resources") or []):
                if (res.get("file_format") or "").upper() == "PDF":
                    pdf_url = res.get("link")
                    break

            citations = (item.get("inline_links") or {}).get("cited_by", {}).get("total", 0) or 0

            papers.append(Paper(
                paper_id=f"gs_{result_id}",
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
        print(f"Google Scholar search error: {e}")
        return []


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


def _normalize_title(title: str) -> str:
    """标题规范化：Unicode 归一化 → ASCII → 小写 → 去首尾标点 → 压缩空白。"""
    t = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    t = t.lower().rstrip(".,;:!?。，；：！？").strip()
    return re.sub(r"\s+", " ", t)


def _merge(existing: Paper, newcomer: Paper) -> Paper:
    """用后来的论文补全现有版本的空字段，引用数取最大值，摘要取更长的。"""
    abstract = existing.abstract
    if newcomer.abstract and (not abstract or len(newcomer.abstract) > len(abstract)):
        abstract = newcomer.abstract
    return existing.model_copy(update={
        "pdf_url":   existing.pdf_url or newcomer.pdf_url,
        "abstract":  abstract,
        "citations": max(existing.citations, newcomer.citations),
        "doi":       existing.doi or newcomer.doi,
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

        # 新论文 → 加入
        idx = len(result)
        result.append(p)
        if doi_key:
            seen_dois[doi_key] = idx
        seen_titles[title_key] = idx

    return result


async def search_all_sources(parsed: ParsedQuery, limit_per_source: int = 10) -> list[Paper]:
    results = await asyncio.gather(
        _search_arxiv(parsed, limit_per_source),
        _search_semantic_scholar(parsed, limit_per_source),
        _search_openalex(parsed, limit_per_source),
        _search_pubmed(parsed, limit_per_source),
        _search_core(parsed, limit_per_source),
        _search_inspire(parsed, limit_per_source),
        _search_europepmc(parsed, limit_per_source),
        _search_nasa_ads(parsed, limit_per_source),
        _search_crossref(parsed, limit_per_source),
        _search_google_scholar(parsed, limit_per_source),
    )
    all_papers = [p for source_results in results for p in source_results]
    return deduplicate(all_papers)
