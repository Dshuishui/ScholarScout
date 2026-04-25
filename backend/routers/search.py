import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, Response
from models import SearchRequest
from services.llm_service import parse_query, validate_papers
from services.search_service import search_all_sources
from services.download_service import fetch_pdf_bytes
from config import SEARCH_RAW_LIMIT, VALIDATED_LIMIT

router = APIRouter()


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/search")
async def search(request: SearchRequest):
    async def generate():
        try:
            yield sse("progress", {"message": "正在理解您的需求..."})
            parsed = await parse_query(request.query, request.api_key)

            kw_str = "、".join(parsed.keywords)
            yield sse("progress", {"message": f"正在搜索关键词：{kw_str}..."})
            papers = await search_all_sources(parsed, limit_per_source=SEARCH_RAW_LIMIT // 3)

            if not papers:
                yield sse("done", {"papers": [], "message": "未找到相关论文，请尝试换个描述方式。"})
                return

            yield sse("progress", {"message": f"找到 {len(papers)} 篇论文，正在验证相关性..."})
            validated = await validate_papers(papers, request.query, request.api_key)
            final = validated[:VALIDATED_LIMIT]

            papers_dict = [p.model_dump() for p in final]
            yield sse("done", {
                "papers": papers_dict,
                "message": f"为您找到 {len(final)} 篇相关论文。"
            })

        except Exception as e:
            yield sse("error", {"message": f"搜索出错：{str(e)}"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/download")
async def download(url: str):
    try:
        content, content_type = await fetch_pdf_bytes(url)
        return Response(
            content=content,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=paper.pdf"},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"下载失败: {str(e)}")
