import asyncio
import xml.etree.ElementTree as ET
import feedparser
import httpx
from models import Paper, ParsedQuery
from config import CORE_API_KEY


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
                headers={"User-Agent": "ScholarScout/1.0 (mailto:user@example.com)"},
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

        headers = {"User-Agent": "ScholarScout/1.0 (mailto:user@example.com)"}
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


def deduplicate(papers: list[Paper]) -> list[Paper]:
    seen_dois: set[str] = set()
    seen_titles: set[str] = set()
    result = []
    for p in papers:
        title_key = p.title.strip().lower()
        if p.doi and p.doi in seen_dois:
            continue
        if title_key in seen_titles:
            continue
        if p.doi:
            seen_dois.add(p.doi)
        seen_titles.add(title_key)
        result.append(p)
    return result


async def search_all_sources(parsed: ParsedQuery, limit_per_source: int = 10) -> list[Paper]:
    results = await asyncio.gather(
        _search_arxiv(parsed, limit_per_source),
        _search_semantic_scholar(parsed, limit_per_source),
        _search_openalex(parsed, limit_per_source),
        _search_pubmed(parsed, limit_per_source),
        _search_core(parsed, limit_per_source),
    )
    all_papers = [p for source_results in results for p in source_results]
    return deduplicate(all_papers)
