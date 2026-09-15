import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from services.download_service import fetch_pdf_bytes


@pytest.mark.asyncio
async def test_fetch_pdf_bytes_success():
    mock_response = AsyncMock()
    mock_response.url = "https://arxiv.org/pdf/2301.00001.pdf"
    mock_response.headers = {"content-type": "application/pdf", "content-length": "17"}
    mock_response.raise_for_status = MagicMock()

    async def fake_aiter_bytes(chunk_size):
        yield b"%PDF-fake-content"

    mock_response.aiter_bytes = fake_aiter_bytes

    mock_stream_cm = AsyncMock()
    mock_stream_cm.__aenter__ = AsyncMock(return_value=mock_response)
    mock_stream_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("services.download_service.httpx.AsyncClient") as MockClient, \
         patch("services.download_service._resolve_host", new=AsyncMock(return_value=["151.101.1.42"])):
        instance = MockClient.return_value.__aenter__.return_value
        instance.stream = MagicMock(return_value=mock_stream_cm)
        content, content_type = await fetch_pdf_bytes("https://arxiv.org/pdf/2301.00001.pdf")

    assert content == b"%PDF-fake-content"
    assert content_type == "application/pdf"


@pytest.mark.asyncio
async def test_fetch_pdf_bytes_invalid_url():
    with pytest.raises(ValueError, match="不安全地址"):
        await fetch_pdf_bytes("ftp://evil.com/file.pdf")


@pytest.mark.asyncio
async def test_fetch_pdf_bytes_blocked_private_ip():
    with pytest.raises(ValueError, match="不安全地址"):
        await fetch_pdf_bytes("https://192.168.1.1/paper.pdf")



# ── SSRF 防护 ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("resolved", ["127.0.0.1", "169.254.0.23", "10.0.0.5", "::1", "::ffff:192.168.1.1", "100.64.0.1"])
async def test_domain_resolving_to_internal_address_is_blocked(resolved):
    # 以前只看字面：metadata.tencentyun.com 这类解析到内网的域名能通过
    with patch("services.download_service._resolve_host", new=AsyncMock(return_value=[resolved])):
        with pytest.raises(ValueError, match="不安全地址"):
            await fetch_pdf_bytes("https://metadata.tencentyun.com/paper.pdf")


@pytest.mark.asyncio
async def test_redirect_to_internal_address_is_blocked_before_request():
    """公网地址 302 跳到内网：必须在请求内网之前拦下（以前是先跟随跳转、事后才检查）。"""
    requested = []

    class Resp:
        def __init__(self, status, headers):
            self.status_code, self.headers = status, headers

    class StreamCM:
        def __init__(self, url): self.url = url
        async def __aenter__(self):
            requested.append(self.url)
            return Resp(302, {"location": "http://internal.example/secret.pdf"})
        async def __aexit__(self, *a): return False

    async def resolve(host):
        return ["10.0.0.8"] if host == "internal.example" else ["93.184.216.34"]

    with patch("services.download_service.httpx.AsyncClient") as MockClient, \
         patch("services.download_service._resolve_host", new=resolve):
        MockClient.return_value.__aenter__.return_value.stream = lambda method, url: StreamCM(url)
        with pytest.raises(ValueError, match="不安全地址"):
            await fetch_pdf_bytes("https://public.example/paper.pdf")
    assert requested == ["https://public.example/paper.pdf"]  # 内网地址从未被请求


def test_literal_ip_and_port_checks():
    from services.download_service import _is_safe_url
    assert not _is_safe_url("http://127.0.0.1/a.pdf")
    assert not _is_safe_url("http://[::1]/a.pdf")
    assert not _is_safe_url("http://localhost/a.pdf")
    assert not _is_safe_url("https://example.com:3001/a.pdf")
    assert _is_safe_url("https://arxiv.org/pdf/1706.03762")
