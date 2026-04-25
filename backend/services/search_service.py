import asyncio
import httpx
from paper_search_mcp.academic_platforms.arxiv import ArxivSearcher
from models import Paper, ParsedQuery


def _arxiv_to_paper(raw) -> Paper:
    return Paper(
        paper_id=str(getattr(raw, "paper_id", "") or ""),
        title=getattr(raw, "title", "").strip(),
        authors=list(getattr(raw, "authors", []) or []),
        abstract=getattr(raw, "abstract", None),
        published_date=str(getattr(raw, "published_date", ""))[:10] if getattr(raw, "published_date", None) else None,
        doi=getattr(raw, "doi", None) or None,
        pdf_url=getattr(raw, "pdf_url", None) or None,
        url=getattr(raw, "url", None) or None,
        source="arXiv",
        citations=int(getattr(raw, "citations", 0) or 0),
    )


async def _search_arxiv(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        # OR 连接关键词，扩大召回；日期直接传入查询，而非事后过滤
        kw_part = " OR ".join(f'all:{kw}' for kw in parsed.keywords)
        query = f'({kw_part})'
        if parsed.date_from:
            date_str = parsed.date_from.replace("-", "")  # "2023-01-01" -> "20230101"
            query += f' AND submittedDate:[{date_str}000000 TO *]'
        searcher = ArxivSearcher()
        results = searcher.search(query, max_results=limit)
        return [_arxiv_to_paper(r) for r in results]
    except Exception as e:
        print(f"arXiv search error: {e}")
        return []


async def _search_semantic_scholar(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        query = " ".join(parsed.keywords)
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": query,
            "limit": limit,
            "fields": "paperId,title,authors,abstract,year,externalIds,openAccessPdf,citationCount",
        }
        # 日期传给 API，让服务端过滤，而非事后丢弃
        if parsed.date_from:
            params["year"] = f"{parsed.date_from[:4]}-"  # e.g. "2023-"
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for item in data.get("data", []):
            year = item.get("year")
            published_date = f"{year}-01-01" if year else None
            doi = (item.get("externalIds") or {}).get("DOI")
            oa = item.get("openAccessPdf") or {}
            papers.append(Paper(
                paper_id=item.get("paperId", ""),
                title=item.get("title", ""),
                authors=[a.get("name", "") for a in item.get("authors", [])],
                abstract=item.get("abstract"),
                published_date=published_date,
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
        query = " ".join(parsed.keywords)
        url = "https://api.openalex.org/works"
        params = {
            "search": query,
            "per_page": limit,
            "select": "id,title,authorships,abstract_inverted_index,publication_date,doi,open_access,cited_by_count",
        }
        if parsed.date_from:
            params["filter"] = f"publication_date:>{parsed.date_from}"

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url, params=params,
                                    headers={"User-Agent": "ScholarScout/1.0 (mailto:user@example.com)"})
            resp.raise_for_status()
            data = resp.json()

        papers = []
        for item in data.get("results", []):
            doi = item.get("doi", "").replace("https://doi.org/", "") or None
            oa = item.get("open_access", {})
            pdf_url = oa.get("oa_url") if oa.get("is_oa") else None
            work_id = item.get("id", "").replace("https://openalex.org/", "")

            # reconstruct abstract from inverted index
            abstract = None
            inv = item.get("abstract_inverted_index")
            if inv:
                words = {}
                for word, positions in inv.items():
                    for pos in positions:
                        words[pos] = word
                abstract = " ".join(words[i] for i in sorted(words))

            authors = [
                a.get("author", {}).get("display_name", "")
                for a in item.get("authorships", [])[:5]
            ]

            papers.append(Paper(
                paper_id=work_id,
                title=item.get("title", ""),
                authors=authors,
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
    )
    all_papers = [p for source_results in results for p in source_results]
    return deduplicate(all_papers)
