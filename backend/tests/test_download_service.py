import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from services.download_service import fetch_pdf_bytes


@pytest.mark.asyncio
async def test_fetch_pdf_bytes_success():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b"%PDF-fake-content"
    mock_response.headers = {"content-type": "application/pdf"}
    mock_response.raise_for_status = MagicMock()

    with patch("services.download_service.httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(return_value=mock_response)
        content, content_type = await fetch_pdf_bytes("https://arxiv.org/pdf/2301.00001.pdf")

    assert content == b"%PDF-fake-content"
    assert "pdf" in content_type


@pytest.mark.asyncio
async def test_fetch_pdf_bytes_invalid_url():
    with pytest.raises(ValueError, match="不支持的 URL"):
        await fetch_pdf_bytes("ftp://evil.com/file.pdf")


@pytest.mark.asyncio
async def test_fetch_pdf_bytes_blocked_domain():
    with pytest.raises(ValueError, match="不支持的 URL"):
        await fetch_pdf_bytes("https://malicious-site.com/paper.pdf")
