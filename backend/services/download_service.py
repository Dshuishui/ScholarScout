"""PDF 下载服务：6 级 fallback 链，最大化开放获取覆盖率。
优先级：primary URL → Unpaywall → Semantic Scholar → arXiv → PMC → Sci-Hub
"""
import asyncio
import logging
import re
import httpx
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
ALLOWED_CONTENT_TYPES = ("application/pdf", "application/octet-stream", "binary/octet-stream")

_POLITE_EMAIL = "scholarscout.search@gmail.com"

_SCI_HUB_MIRRORS = [
    "https://sci-hub.se",
    "https://sci-hub.st",
    "https://sci-hub.ru",
]

_PRIVATE_IP = re.compile(
    r"^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|"
    r"::1$|^localhost$|^0\.0\.0\.0)"
)

_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _is_safe_url(url: str) -> bool:
    """防 SSRF：拒绝私有 IP / 非标准端口，允许所有公网域名。"""
    try:
        p = urlparse(url)
        if p.scheme not in ("http", "https"):
            return False
        host = (p.hostname or "").lower()
        if _PRIVATE_IP.match(host):
            return False
        # 拒绝非标准端口（80/443 以外）
        port = p.port
        if port is not None and port not in (80, 443):
            return False
        return True
    except Exception:
        return False


def _extract_pdf_url_from_html(html: str, base_url: str) -> str | None:
    """从 HTML 落地页提取 PDF 直链。
    优先级：citation_pdf_url meta → link[type=pdf] → .pdf href。
    """
    from urllib.parse import urljoin
    patterns = [
        # 学术出版商标准 meta 标签（arXiv、bioRxiv、Springer、Wiley 等均支持）
        r'<meta[^>]+name=["\']citation_pdf_url["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']citation_pdf_url["\']',
        # <link rel="alternate" type="application/pdf">（arXiv 使用）
        r'<link[^>]+type=["\']application/pdf["\'][^>]+href=["\']([^"\']+)["\']',
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+type=["\']application/pdf["\']',
        # 页面内 .pdf 直链（兜底）
        r'href=["\']([^"\']+\.pdf(?:\?[^"\']*)?)["\']',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.I)
        if m:
            return urljoin(base_url, m.group(1))
    return None


async def _fetch_bytes(url: str, timeout: int = 25, _depth: int = 0) -> bytes:
    """下载单个 URL，返回 PDF 字节；失败抛 ValueError。
    遇到 HTML 落地页时自动提取 PDF 链接并重试（最多 2 层）。
    """
    if _depth > 2:
        raise ValueError("落地页跳转层数超限")
    if not _is_safe_url(url):
        raise ValueError(f"不安全地址: {url}")

    async with httpx.AsyncClient(
        follow_redirects=True,
        timeout=timeout,
        headers={"User-Agent": _UA, "Accept": "application/pdf,*/*;q=0.9"},
    ) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            if not _is_safe_url(str(resp.url)):
                raise ValueError("重定向到私有地址")

            ct = resp.headers.get("content-type", "").split(";")[0].strip()
            total, chunks = 0, []
            async for chunk in resp.aiter_bytes(65536):
                total += len(chunk)
                if total > MAX_FILE_SIZE:
                    raise ValueError("文件超过 50 MB")
                chunks.append(chunk)
            final_url = str(resp.url)

    data = b"".join(chunks)

    if ct.startswith("text/html"):
        html = data.decode("utf-8", errors="ignore")
        pdf_url = _extract_pdf_url_from_html(html, final_url)
        if pdf_url and _is_safe_url(pdf_url):
            logger.debug("HTML landing page → PDF: %s", pdf_url)
            return await _fetch_bytes(pdf_url, timeout=timeout, _depth=_depth + 1)
        raise ValueError("收到 HTML 落地页，未能提取 PDF 链接")

    if not any(ct.startswith(t) for t in ALLOWED_CONTENT_TYPES):
        raise ValueError(f"不支持的文件类型: {ct}")

    if not data.startswith(b"%PDF"):
        raise ValueError("非有效 PDF（无 %PDF 魔数）")
    return data


# ── 各 fallback 源 ──────────────────────────────────────────────────────────

async def _via_unpaywall(doi: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"https://api.unpaywall.org/v2/{doi}",
                params={"email": _POLITE_EMAIL},
            )
            if r.status_code == 200:
                loc = r.json().get("best_oa_location") or {}
                pdf_url = loc.get("url_for_pdf") or loc.get("url")
                if pdf_url:
                    return await _fetch_bytes(pdf_url)
    except Exception as e:
        logger.debug("Unpaywall failed for %s: %s", doi, e)
    return None


async def _via_semantic_scholar(doi: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"https://api.semanticscholar.org/graph/v1/paper/DOI:{doi}",
                params={"fields": "openAccessPdf"},
            )
            if r.status_code == 200:
                oa = r.json().get("openAccessPdf") or {}
                pdf_url = oa.get("url")
                if pdf_url:
                    return await _fetch_bytes(pdf_url)
    except Exception as e:
        logger.debug("Semantic Scholar failed for %s: %s", doi, e)
    return None


def _arxiv_id(paper_id: str, doi: str | None) -> str | None:
    """从 paper_id 或 DOI 中提取 arXiv ID。"""
    # paper_id 直接是 arXiv ID
    pid = paper_id.strip()
    for prefix in ("arxiv:", "arxiv_"):
        if pid.lower().startswith(prefix):
            pid = pid[len(prefix):]
            break
    if re.match(r"^\d{4}\.\d{4,5}(v\d+)?$", pid):
        return pid
    if re.match(r"^[a-z\-]+/\d{7}(v\d+)?$", pid.lower()):
        return pid

    # DOI 格式 10.48550/arXiv.YYMM.NNNNN
    if doi:
        m = re.search(r"arxiv[./](\d{4}\.\d{4,5})", doi, re.I)
        if m:
            return m.group(1)
    return None


async def _via_arxiv(paper_id: str, doi: str | None) -> bytes | None:
    ax_id = _arxiv_id(paper_id, doi)
    if not ax_id:
        return None
    try:
        return await _fetch_bytes(f"https://arxiv.org/pdf/{ax_id}")
    except Exception as e:
        logger.debug("arXiv failed for %s: %s", ax_id, e)
    return None


async def _via_pmc(paper_id: str) -> bytes | None:
    """paper_id = 'pubmed_PMID' 时尝试从 PMC 下载。"""
    if not paper_id.startswith("pubmed_"):
        return None
    pmid = paper_id[7:]
    try:
        # 用 eutils 查 PMCID
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi",
                params={
                    "dbfrom": "pubmed", "db": "pmc",
                    "id": pmid, "retmode": "json",
                },
            )
            data = r.json()
            ids = (
                data.get("linksets", [{}])[0]
                    .get("linksetdbs", [{}])[0]
                    .get("links", [])
            )
            if ids:
                pmcid = f"PMC{ids[0]}"
                return await _fetch_bytes(
                    f"https://www.ncbi.nlm.nih.gov/pmc/articles/{pmcid}/pdf/"
                )
    except Exception as e:
        logger.debug("PMC failed for %s: %s", paper_id, e)
    return None


async def _via_biorxiv(doi: str) -> bytes | None:
    """通过 bioRxiv / medRxiv API 查找预印本 PDF（生命科学论文常见来源）。"""
    if not doi:
        return None
    for server in ("biorxiv", "medrxiv"):
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(f"https://api.biorxiv.org/details/{server}/{doi}/na/json")
                if r.status_code != 200:
                    continue
                collection = r.json().get("collection", [])
                if not collection:
                    continue
                # 取最新版本
                latest = sorted(collection, key=lambda x: x.get("version", 0), reverse=True)[0]
                biorxiv_doi = latest.get("doi", "")
                if biorxiv_doi:
                    pdf_url = f"https://www.{server}.org/content/{biorxiv_doi}.full.pdf"
                    return await _fetch_bytes(pdf_url)
        except Exception as e:
            logger.debug("bioRxiv/medRxiv failed for %s: %s", doi, e)
    return None


async def _via_scihub(doi: str) -> bytes | None:
    """尝试多个 Sci-Hub 镜像，解析嵌入的 PDF URL 后下载。"""
    if not doi:
        return None
    for mirror in _SCI_HUB_MIRRORS:
        try:
            async with httpx.AsyncClient(
                follow_redirects=True, timeout=20,
                headers={"User-Agent": _UA},
            ) as client:
                r = await client.get(f"{mirror}/{doi}")
                if r.status_code != 200:
                    continue

                ct = r.headers.get("content-type", "")
                # 有时直接返回 PDF
                if "pdf" in ct or r.content[:4] == b"%PDF":
                    if r.content[:4] == b"%PDF":
                        return r.content
                    continue

                # 解析 HTML 中的 PDF 链接
                html = r.text
                # 匹配 <embed src="..." / <iframe src="..." / location.href='...'
                patterns = [
                    r'<embed[^>]+src=["\']?(/[^"\'> ]+)["\']?',
                    r'<iframe[^>]+src=["\']?(https?://[^"\'> ]+)["\']?',
                    r"location\.href\s*=\s*['\"]([^'\"]+\.pdf[^'\"]*)['\"]",
                    r'src=["\']?(https?://[^"\'> ]+\.pdf(?:\?[^"\'> ]*)?)["\']?',
                ]
                pdf_url = None
                for pat in patterns:
                    m = re.search(pat, html, re.I)
                    if m:
                        pdf_url = m.group(1)
                        if pdf_url.startswith("/"):
                            pdf_url = f"{mirror}{pdf_url}"
                        break

                if pdf_url:
                    data = await _fetch_bytes(pdf_url)
                    return data

        except Exception as e:
            logger.debug("Sci-Hub mirror %s failed for %s: %s", mirror, doi, e)
    return None


# ── 主入口 ──────────────────────────────────────────────────────────────────

async def fetch_pdf_bytes(url: str) -> tuple[bytes, str]:
    """兼容旧接口。"""
    data = await _fetch_bytes(url)
    return data, "application/pdf"


async def fetch_pdf_with_fallback(
    url: str,
    doi: str | None = None,
    paper_id: str | None = None,
) -> bytes:
    """6 级 fallback 链，返回 PDF 字节；全部失败抛 ValueError。"""
    steps = [
        ("primary URL",       lambda: _fetch_bytes(url)),
        ("Unpaywall",         lambda: _via_unpaywall(doi) if doi else None),
        ("Semantic Scholar",  lambda: _via_semantic_scholar(doi) if doi else None),
        ("arXiv",             lambda: _via_arxiv(paper_id or "", doi) if paper_id else None),
        ("PMC",               lambda: _via_pmc(paper_id or "") if paper_id else None),
        ("bioRxiv/medRxiv",   lambda: _via_biorxiv(doi) if doi else None),
        ("Sci-Hub",           lambda: _via_scihub(doi) if doi else None),
    ]

    for name, fn in steps:
        try:
            result = await fn()
            if result:
                logger.info("PDF obtained via %s (doi=%s paper_id=%s)", name, doi, paper_id)
                return result
        except Exception as e:
            logger.debug("Fallback [%s] failed: %s", name, e)

    raise ValueError("所有来源均无法获取 PDF，建议直接访问论文链接下载")
