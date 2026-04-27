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

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


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
        async with client.stream("GET", url, headers={"User-Agent": "ScholarScout/1.0"}) as response:
            response.raise_for_status()

            content_length = int(response.headers.get("content-length", 0))
            if content_length > MAX_FILE_SIZE:
                raise ValueError(f"文件过大（{content_length // 1024 // 1024}MB），超过 50MB 限制")

            content_type = response.headers.get("content-type", "application/pdf")
            total = 0
            chunks: list[bytes] = []
            async for chunk in response.aiter_bytes(65536):
                total += len(chunk)
                if total > MAX_FILE_SIZE:
                    raise ValueError("文件过大，超过 50MB 限制")
                chunks.append(chunk)

    return b"".join(chunks), content_type
