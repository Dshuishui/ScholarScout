import asyncio
import io
from fastapi import APIRouter, UploadFile, File
from typing import Optional

router = APIRouter()

MAX_CHARS = 3_936_000  # DeepSeek V4 Flash/Pro 1M tokens × ~4 chars/token，减去 16K 预留
# 与 nginx 里 /api/paper/parse-pdf 的 client_max_body_size 保持一致
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


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


# 以前还有 /fetch-pdf（服务端代为下载任意 URL 再解析）：前端早已不用，且没有内网地址校验、
# 响应整个读进内存，会被用来探测内网或撑爆内存，已删除。


@router.post("/parse-pdf")
async def parse_pdf(file: UploadFile = File(...)):
    name = file.filename or ''
    if not name.lower().endswith('.pdf'):
        return {"error": "invalid_file"}
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        return {"error": "too_large"}
    # pypdf 解析是纯 CPU 计算，放到线程里，避免大文件卡住所有其他请求
    text = await asyncio.to_thread(_extract_text, content)
    if not text:
        return {"error": "extract_failed"}
    return {"text": text}
