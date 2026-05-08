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

    with patch("services.download_service.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.stream = MagicMock(return_value=mock_stream_cm)
        content, content_type = await fetch_pdf_bytes("https://arxiv.org/pdf/2301.00001.pdf")

    assert content == b"%PDF-fake-content"
    assert content_type == "application/pdf"


@pytest.mark.asyncio
async def test_fetch_pdf_bytes_invalid_url():
    with pytest.raises(ValueError, match="不支持的下载地址"):
        await fetch_pdf_bytes("ftp://evil.com/file.pdf")


@pytest.mark.asyncio
async def test_fetch_pdf_bytes_blocked_domain():
    with pytest.raises(ValueError, match="不支持的下载地址"):
        await fetch_pdf_bytes("https://malicious-site.com/paper.pdf")
