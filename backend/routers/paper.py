import io
import httpx
from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

MAX_CHARS = 12000  # ~3000 tokens


def _extract_text(pdf_bytes: bytes) -> Optional[str]:
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        parts: list[str] = []
        total = 0
        for page in reader.pages:
            text = page.extract_text() or ''
            parts.append(text)
            total += len(text)
            if total >= MAX_CHARS:
                break
        full = '\n'.join(parts).strip()
        return full[:MAX_CHARS] if full else None
    except Exception:
        return None


class FetchPdfRequest(BaseModel):
    pdf_url: str


@router.post("/fetch-pdf")
async def fetch_pdf(req: FetchPdfRequest):
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(
                req.pdf_url,
                headers={'User-Agent': 'Mozilla/5.0 (compatible; ScholarScout/1.0; mailto:admin@scholarscout.app)'},
            )
            if r.status_code != 200:
                return {"error": f"HTTP {r.status_code}"}
            content_type = r.headers.get('content-type', '').lower()
            if 'pdf' not in content_type and not req.pdf_url.lower().endswith('.pdf'):
                return {"error": "not_pdf"}
            text = _extract_text(r.content)
            if not text:
                return {"error": "extract_failed"}
            return {"text": text}
    except httpx.TimeoutException:
        return {"error": "timeout"}
    except Exception as e:
        return {"error": str(e)}


@router.post("/parse-pdf")
async def parse_pdf(file: UploadFile = File(...)):
    name = file.filename or ''
    if not name.lower().endswith('.pdf'):
        return {"error": "invalid_file"}
    try:
        content = await file.read()
        text = _extract_text(content)
        if not text:
            return {"error": "extract_failed"}
        return {"text": text}
    except Exception as e:
        return {"error": str(e)}
