import httpx
from urllib.parse import urlparse

ALLOWED_DOMAINS = [
    "arxiv.org",
    "europepmc.org",
    "ncbi.nlm.nih.gov",
    "core.ac.uk",
    "biorxiv.org",
    "medrxiv.org",
    "zenodo.org",
    "hal.science",
    "semanticscholar.org",
    "openalex.org",
    "pmc.ncbi.nlm.nih.gov",
]


def _is_allowed(url: str) -> bool:
    try:
        host = urlparse(url).netloc.lower()
        scheme = urlparse(url).scheme.lower()
        if scheme not in ("http", "https"):
            return False
        return any(host == d or host.endswith("." + d) for d in ALLOWED_DOMAINS)
    except Exception:
        return False


async def fetch_pdf_bytes(url: str) -> tuple[bytes, str]:
    if not _is_allowed(url):
        raise ValueError(f"不支持的 URL: {url}")

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        response = await client.get(url, headers={"User-Agent": "ScholarScout/1.0"})
        response.raise_for_status()
        return response.content, response.headers.get("content-type", "application/pdf")
