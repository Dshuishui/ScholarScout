import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, Response
from models import SearchRequest, ParseRequest, ParsedQuery
from services.llm_service import classify_intent, parse_query, validate_papers
from services.search_service import search_all_sources
from services.download_service import fetch_pdf_bytes

router = APIRouter()


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/parse")
async def parse(request: ParseRequest):
    """Phase 1: 意图识别 + 关键词提取，返回普通 JSON 供前端展示确认。"""
    history = [{"role": m.role, "content": m.content} for m in request.messages]
    intent = await classify_intent(request.query, request.api_key, history)
    if intent.get("intent") == "chat":
        return {"intent": "chat", "reply": intent.get("reply", "请问有什么可以帮您？")}
    parsed = await parse_query(request.query, request.api_key, history)
    return {
        "intent": "search",
        "keywords": parsed.keywords,
        "date_from": parsed.date_from,
        "date_to": parsed.date_to,
    }


@router.post("/search")
async def search(request: SearchRequest):
    """Phase 2: 执行搜索 + 验证，SSE 流式推送进度和结果。
    若 request.keywords 已提供，跳过意图识别和关键词解析。"""
    async def generate():
        try:
            history = [{"role": m.role, "content": m.content} for m in request.messages]

            if request.keywords:
                # 前端已确认关键词，直接构造 ParsedQuery
                parsed = ParsedQuery(
                    keywords=request.keywords,
                    date_from=request.date_from,
                    date_to=request.date_to,
                    max_results=request.limit_per_source,
                )
            else:
                # 旧路径：兼容不带关键词的调用
                intent = await classify_intent(request.query, request.api_key, history)
                if intent.get("intent") == "chat":
                    yield sse("chat", {"message": intent.get("reply", "请问有什么可以帮您？")})
                    return
                yield sse("progress", {"message": "正在理解您的需求..."})
                parsed = await parse_query(request.query, request.api_key, history)

            kw_str = "、".join(parsed.keywords)
            yield sse("progress", {"message": f"正在搜索关键词：{kw_str}..."})
            papers = await search_all_sources(parsed, limit_per_source=request.limit_per_source)
            if not papers:
                yield sse("done", {"papers": [], "message": "未找到相关论文，请尝试换个描述方式。"})
                return

            yield sse("progress", {"message": f"找到 {len(papers)} 篇论文，正在验证相关性..."})
            validated = await validate_papers(papers, request.query, request.api_key)
            final = validated[:request.validated_limit]

            papers_dict = [p.model_dump() for p in final]
            yield sse("done", {
                "papers": papers_dict,
                "message": f"为您找到 {len(final)} 篇相关论文。"
            })

        except Exception as e:
            yield sse("error", {"message": f"出错了：{str(e)}"})

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
