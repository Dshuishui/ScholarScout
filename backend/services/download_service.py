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


ALLOWED_CONTENT_TYPES = ("application/pdf", "application/octet-stream", "binary/octet-stream")


async def fetch_pdf_bytes(url: str) -> tuple[bytes, str]:
    if not _is_allowed(url):
        raise ValueError("不支持的下载地址")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/pdf,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://scholar.google.com/",
    }

    async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
        async with client.stream("GET", url, headers=headers) as response:
            response.raise_for_status()

            # 重定向后重新校验最终域名
            final_url = str(response.url)
            if not _is_allowed(final_url):
                raise ValueError("不支持的下载地址")

            content_type = response.headers.get("content-type", "application/pdf").split(";")[0].strip()
            if content_type.startswith("text/html"):
                raise ValueError("来源网站拒绝了下载请求（可能需要登录或有防爬限制），建议直接访问原网站下载")
            if not any(content_type.startswith(ct) for ct in ALLOWED_CONTENT_TYPES):
                raise ValueError(f"文件类型不支持（{content_type}）")

            content_length = int(response.headers.get("content-length", 0))
            if content_length > MAX_FILE_SIZE:
                raise ValueError("文件过大，超过 50MB 限制")

            total = 0
            chunks: list[bytes] = []
            async for chunk in response.aiter_bytes(65536):
                total += len(chunk)
                if total > MAX_FILE_SIZE:
                    raise ValueError("文件过大，超过 50MB 限制")
                chunks.append(chunk)

    return b"".join(chunks), "application/pdf"
