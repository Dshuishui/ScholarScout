# ScholarScout V1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个面向非技术用户的学术论文搜索工具，用户输入 DeepSeek Key 后可用中文自然语言描述需求，系统自动搜索真实论文并返回可预览/下载的结果列表。

**Architecture:** 左右分栏 Web 应用。左侧为对话区（用户输入 + AI 回复），右侧为论文结果区（卡片列表 + 链接/下载）。前端 React + Vite 静态文件由 Nginx 托管，后端 FastAPI 运行在同一服务器的 8000 端口，Nginx 反代 `/api/*` 请求。搜索流程通过 SSE 流式推送进度，避免用户等待时界面无响应。

**Tech Stack:**
- 后端: Python 3.11, FastAPI, uvicorn, paper-search-mcp, openai (DeepSeek 兼容)
- 前端: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- 部署: Nginx, systemd, 服务器 118.25.192.117

---

## 文件结构

```
ScholarScout/
├── backend/
│   ├── main.py                    # FastAPI app、CORS、挂载路由
│   ├── config.py                  # 全局配置常量
│   ├── models.py                  # Pydantic 数据模型
│   ├── services/
│   │   ├── llm_service.py         # DeepSeek 调用：解析 query、验证相关性
│   │   ├── search_service.py      # paper-search-mcp 并发搜索 + 去重
│   │   └── download_service.py    # PDF 代理下载
│   ├── routers/
│   │   └── search.py              # /api/search (SSE) + /api/download
│   ├── requirements.txt
│   └── tests/
│       ├── test_llm_service.py
│       ├── test_search_service.py
│       └── test_download_service.py
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                # 路由：KeySetupScreen vs MainLayout
│   │   ├── types/
│   │   │   └── index.ts           # Paper、Message 等 TS 类型
│   │   ├── api/
│   │   │   └── client.ts          # 后端 API 调用、SSE 处理
│   │   ├── hooks/
│   │   │   ├── useApiKey.ts       # localStorage key 读写
│   │   │   └── useSearch.ts       # 搜索状态管理
│   │   └── components/
│   │       ├── KeySetupScreen.tsx # 首次使用 Key 输入页
│   │       ├── MainLayout.tsx     # 左右分栏容器
│   │       ├── ChatPanel.tsx      # 左侧对话区
│   │       ├── MessageBubble.tsx  # 单条对话气泡
│   │       ├── ResultsPanel.tsx   # 右侧论文列表区
│   │       └── PaperCard.tsx      # 单篇论文卡片
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── tsconfig.json
└── deploy/
    ├── nginx.conf
    └── scholarscout-backend.service
```

---

## ✅ Task 1: 后端项目初始化 (已完成)

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/config.py`
- Create: `backend/main.py`

- [ ] **Step 1: 创建 requirements.txt**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
openai==1.51.0
paper-search-mcp==0.1.0
httpx==0.27.2
python-dotenv==1.0.1
pytest==8.3.3
pytest-asyncio==0.24.0
pytest-mock==3.14.0
```

> 安装依赖：
> ```bash
> cd backend && python -m venv venv && source venv/bin/activate
> pip install -r requirements.txt
> ```

- [ ] **Step 2: 创建 config.py**

```python
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"
SEARCH_SOURCES = ["arxiv", "semantic_scholar", "openalex"]
SEARCH_RAW_LIMIT = 30    # 每个源最多取多少篇
VALIDATED_LIMIT = 15     # LLM 过滤后最多展示多少篇
CORS_ORIGINS = ["*"]     # 生产环境替换为实际域名/IP
```

- [ ] **Step 3: 创建 main.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import search
from config import CORS_ORIGINS

app = FastAPI(title="ScholarScout API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router, prefix="/api")
```

- [ ] **Step 4: 验证 FastAPI 能启动**

```bash
cd backend
uvicorn main:app --reload --port 8000
# 访问 http://localhost:8000/docs 应看到 Swagger UI
```

- [ ] **Step 5: 提交**

```bash
git add backend/
git commit -m "feat: backend project skeleton"
```

---

## ✅ Task 2: 数据模型定义 (已完成)

**Files:**
- Create: `backend/models.py`

- [ ] **Step 1: 写 models.py**

```python
from pydantic import BaseModel
from typing import Optional

class SearchRequest(BaseModel):
    query: str          # 用户自然语言输入
    api_key: str        # 用户的 DeepSeek Key

class Paper(BaseModel):
    paper_id: str
    title: str
    authors: list[str]
    abstract: Optional[str] = None
    published_date: Optional[str] = None
    doi: Optional[str] = None
    pdf_url: Optional[str] = None
    url: Optional[str] = None
    source: str
    citations: int = 0
    relevance_reason: Optional[str] = None  # LLM 给出的相关性说明

class ParsedQuery(BaseModel):
    keywords: list[str]        # 英文关键词，2-4 个
    date_from: Optional[str]   # "YYYY-01-01" 或 None
    date_to: Optional[str]     # "YYYY-12-31" 或 None
    max_results: int = 30
```

- [ ] **Step 2: 提交**

```bash
git add backend/models.py
git commit -m "feat: define Pydantic data models"
```

---

## ✅ Task 3+5: LLM 服务 — Query 解析 + 相关性验证 (已完成)

**Files:**
- Create: `backend/services/llm_service.py`
- Create: `backend/tests/test_llm_service.py`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_llm_service.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from services.llm_service import parse_query
from models import ParsedQuery

@pytest.mark.asyncio
async def test_parse_query_extracts_keywords():
    mock_response = MagicMock()
    mock_response.choices[0].message.content = '{"keywords": ["RAG", "retrieval augmented generation"], "date_from": "2023-01-01", "date_to": null, "max_results": 30}'

    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await parse_query("找2023年后RAG相关的论文", "sk-fake-key")

    assert isinstance(result, ParsedQuery)
    assert "RAG" in result.keywords
    assert result.date_from == "2023-01-01"
    assert result.date_to is None

@pytest.mark.asyncio
async def test_parse_query_no_date():
    mock_response = MagicMock()
    mock_response.choices[0].message.content = '{"keywords": ["transformer", "attention mechanism"], "date_from": null, "date_to": null, "max_results": 30}'

    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await parse_query("找 transformer 相关论文", "sk-fake-key")

    assert result.date_from is None
    assert "transformer" in result.keywords
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend && pytest tests/test_llm_service.py -v
# 预期: ImportError 或 ModuleNotFoundError
```

- [ ] **Step 3: 实现 llm_service.py**

```python
import json
from openai import AsyncOpenAI
from models import ParsedQuery
from config import DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

PARSE_PROMPT = """你是学术搜索助手。将用户的中文需求转为结构化搜索参数。

用户需求：{query}

返回 JSON（不要有任何额外文字）：
{{
  "keywords": ["英文关键词1", "英文关键词2"],
  "date_from": "YYYY-01-01 或 null",
  "date_to": "YYYY-12-31 或 null",
  "max_results": 30
}}

规则：
- keywords 必须是英文学术术语，2-4 个，从宽到窄排列
- 用户未提时间则 date_from/date_to 为 null
- "最近两年" 相对今天计算"""

async def parse_query(user_query: str, api_key: str) -> ParsedQuery:
    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    response = await client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=[{"role": "user", "content": PARSE_PROMPT.format(query=user_query)}],
        response_format={"type": "json_object"},
        temperature=0.1,
    )
    data = json.loads(response.choices[0].message.content)
    return ParsedQuery(**data)
```

- [ ] **Step 4: 运行确认通过**

```bash
pytest tests/test_llm_service.py -v
# 预期: 2 passed
```

- [ ] **Step 5: 提交**

```bash
git add backend/services/llm_service.py backend/tests/test_llm_service.py
git commit -m "feat: LLM query parsing with DeepSeek"
```

---

## ✅ Task 4: 搜索服务 — 多源并发搜索 (已完成，注：Semantic Scholar 和 OpenAlex 用 REST API 直接实现，paper-search-mcp 0.1.3 只含 arXiv/PubMed)

**Files:**
- Create: `backend/services/search_service.py`
- Create: `backend/tests/test_search_service.py`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_search_service.py
import pytest
from unittest.mock import patch, MagicMock
from services.search_service import search_all_sources, deduplicate
from models import Paper, ParsedQuery

def make_paper(paper_id, title, doi=None, source="arxiv"):
    return Paper(paper_id=paper_id, title=title, authors=["Author A"],
                 source=source, doi=doi)

def test_deduplicate_by_doi():
    papers = [
        make_paper("1", "Paper A", doi="10.1234/abc"),
        make_paper("2", "Paper A", doi="10.1234/abc"),  # 重复 DOI
        make_paper("3", "Paper B", doi="10.1234/xyz"),
    ]
    result = deduplicate(papers)
    assert len(result) == 2

def test_deduplicate_by_title():
    papers = [
        make_paper("1", "Attention Is All You Need"),
        make_paper("2", "Attention Is All You Need"),  # 重复标题
    ]
    result = deduplicate(papers)
    assert len(result) == 1

@pytest.mark.asyncio
async def test_search_all_sources_returns_papers():
    query = ParsedQuery(keywords=["transformer"], date_from=None, date_to=None)
    mock_paper = make_paper("2301.00001", "Test Paper")

    with patch("services.search_service._search_arxiv", return_value=[mock_paper]), \
         patch("services.search_service._search_semantic_scholar", return_value=[]), \
         patch("services.search_service._search_openalex", return_value=[]):
        result = await search_all_sources(query)

    assert len(result) == 1
    assert result[0].title == "Test Paper"
```

- [ ] **Step 2: 运行确认失败**

```bash
pytest tests/test_search_service.py -v
# 预期: ImportError
```

- [ ] **Step 3: 实现 search_service.py**

```python
import asyncio
from models import Paper, ParsedQuery
from paper_search_mcp.academic_platforms.arxiv import ArxivSearcher
from paper_search_mcp.academic_platforms.semantic import SemanticScholarSearcher
from paper_search_mcp.academic_platforms.openalex import OpenAlexSearcher

def _to_paper(raw, source: str) -> Paper:
    return Paper(
        paper_id=str(getattr(raw, "paper_id", "") or ""),
        title=getattr(raw, "title", ""),
        authors=list(getattr(raw, "authors", []) or []),
        abstract=getattr(raw, "abstract", None),
        published_date=str(getattr(raw, "published_date", "") or ""),
        doi=getattr(raw, "doi", None),
        pdf_url=getattr(raw, "pdf_url", None),
        url=getattr(raw, "url", None),
        source=source,
        citations=int(getattr(raw, "citations", 0) or 0),
    )

def _build_query_string(parsed: ParsedQuery) -> str:
    q = " ".join(parsed.keywords)
    if parsed.date_from:
        q += f" after:{parsed.date_from[:4]}"
    return q

async def _search_arxiv(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        searcher = ArxivSearcher()
        q = " AND ".join(parsed.keywords)
        results = searcher.search(q, limit=limit)
        return [_to_paper(r, "arXiv") for r in results]
    except Exception:
        return []

async def _search_semantic_scholar(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        searcher = SemanticScholarSearcher()
        q = " ".join(parsed.keywords)
        results = searcher.search(q, limit=limit)
        return [_to_paper(r, "Semantic Scholar") for r in results]
    except Exception:
        return []

async def _search_openalex(parsed: ParsedQuery, limit: int) -> list[Paper]:
    try:
        searcher = OpenAlexSearcher()
        q = " ".join(parsed.keywords)
        results = searcher.search(q, limit=limit)
        return [_to_paper(r, "OpenAlex") for r in results]
    except Exception:
        return []

def deduplicate(papers: list[Paper]) -> list[Paper]:
    seen_dois: set[str] = set()
    seen_titles: set[str] = set()
    result = []
    for p in papers:
        title_key = p.title.strip().lower()
        if p.doi and p.doi in seen_dois:
            continue
        if title_key in seen_titles:
            continue
        if p.doi:
            seen_dois.add(p.doi)
        seen_titles.add(title_key)
        result.append(p)
    return result

async def search_all_sources(parsed: ParsedQuery, limit_per_source: int = 10) -> list[Paper]:
    results = await asyncio.gather(
        _search_arxiv(parsed, limit_per_source),
        _search_semantic_scholar(parsed, limit_per_source),
        _search_openalex(parsed, limit_per_source),
    )
    all_papers = [p for source_results in results for p in source_results]
    return deduplicate(all_papers)
```

- [ ] **Step 4: 运行确认通过**

```bash
pytest tests/test_search_service.py -v
# 预期: 3 passed
```

- [ ] **Step 5: 提交**

```bash
git add backend/services/search_service.py backend/tests/test_search_service.py
git commit -m "feat: concurrent multi-source search with deduplication"
```

---

## ✅ Task 5: LLM 服务 — 相关性验证 (已完成，合并进 Task 3)

**Files:**
- Modify: `backend/services/llm_service.py`
- Modify: `backend/tests/test_llm_service.py`

- [ ] **Step 1: 补充测试**

在 `test_llm_service.py` 末尾追加：

```python
from services.llm_service import validate_papers
from models import Paper

@pytest.mark.asyncio
async def test_validate_papers_filters_irrelevant():
    papers = [
        Paper(paper_id="1", title="RAG for Legal Documents", authors=["A"],
              abstract="We apply RAG to legal text retrieval.", source="arXiv"),
        Paper(paper_id="2", title="Image Classification with CNN", authors=["B"],
              abstract="We train CNNs on ImageNet.", source="arXiv"),
    ]
    mock_response = MagicMock()
    mock_response.choices[0].message.content = json.dumps([
        {"id": "1", "relevant": True,  "reason": "直接研究 RAG 应用"},
        {"id": "2", "relevant": False, "reason": "与 RAG 无关"},
    ])

    with patch("services.llm_service.AsyncOpenAI") as MockClient:
        instance = MockClient.return_value
        instance.chat.completions.create = AsyncMock(return_value=mock_response)

        result = await validate_papers(papers, "找RAG相关论文", "sk-fake-key")

    assert len(result) == 1
    assert result[0].paper_id == "1"
    assert result[0].relevance_reason == "直接研究 RAG 应用"
```

- [ ] **Step 2: 运行确认失败**

```bash
pytest tests/test_llm_service.py::test_validate_papers_filters_irrelevant -v
# 预期: ImportError (validate_papers 不存在)
```

- [ ] **Step 3: 在 llm_service.py 末尾追加 validate_papers**

```python
import json
from models import Paper

VALIDATE_PROMPT = """用户的原始需求：{query}

以下是搜索到的论文，请判断每篇与用户需求的相关性，过滤掉不相关的。

{papers_text}

返回 JSON 数组（不要有额外文字）：
[
  {{"id": "paper_id", "relevant": true/false, "reason": "一句话说明"}},
  ...
]"""

async def validate_papers(papers: list[Paper], user_query: str, api_key: str) -> list[Paper]:
    if not papers:
        return []

    papers_text = "\n\n".join(
        f"ID: {p.paper_id}\n标题: {p.title}\n摘要: {(p.abstract or '')[:200]}"
        for p in papers
    )

    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    response = await client.chat.completions.create(
        model=DEEPSEEK_MODEL,
        messages=[{"role": "user", "content": VALIDATE_PROMPT.format(
            query=user_query, papers_text=papers_text
        )}],
        response_format={"type": "json_object"},
        temperature=0.1,
    )

    # DeepSeek 返回的可能是 {"results": [...]} 或直接 [...]
    raw = json.loads(response.choices[0].message.content)
    verdicts = raw if isinstance(raw, list) else raw.get("results", raw.get("papers", []))

    verdict_map = {v["id"]: v for v in verdicts if v.get("relevant")}

    result = []
    for p in papers:
        if p.paper_id in verdict_map:
            p.relevance_reason = verdict_map[p.paper_id].get("reason")
            result.append(p)
    return result
```

- [ ] **Step 4: 运行全部 LLM 测试**

```bash
pytest tests/test_llm_service.py -v
# 预期: 3 passed
```

- [ ] **Step 5: 提交**

```bash
git add backend/services/llm_service.py backend/tests/test_llm_service.py
git commit -m "feat: LLM relevance validation for search results"
```

---

## ✅ Task 6: 下载服务 (已完成)

**Files:**
- Create: `backend/services/download_service.py`
- Create: `backend/tests/test_download_service.py`

- [ ] **Step 1: 写测试**

```python
# backend/tests/test_download_service.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from services.download_service import fetch_pdf_bytes

@pytest.mark.asyncio
async def test_fetch_pdf_bytes_success():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b"%PDF-fake-content"
    mock_response.headers = {"content-type": "application/pdf"}

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
```

- [ ] **Step 2: 实现 download_service.py**

```python
import httpx
from urllib.parse import urlparse

ALLOWED_DOMAINS = [
    "arxiv.org", "europepmc.org", "ncbi.nlm.nih.gov",
    "core.ac.uk", "unpaywall.org", "biorxiv.org",
    "medrxiv.org", "zenodo.org", "hal.science",
]

def _is_allowed(url: str) -> bool:
    try:
        host = urlparse(url).netloc.lower()
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
```

- [ ] **Step 3: 运行测试**

```bash
pytest tests/test_download_service.py -v
# 预期: 2 passed
```

- [ ] **Step 4: 提交**

```bash
git add backend/services/download_service.py backend/tests/test_download_service.py
git commit -m "feat: PDF proxy download with domain allowlist"
```

---

## ✅ Task 7: API 路由（SSE 流式返回）(已完成)

**Files:**
- Create: `backend/routers/search.py`
- Create: `backend/routers/__init__.py`

- [ ] **Step 1: 创建 routers/__init__.py**

空文件即可：
```python
```

- [ ] **Step 2: 创建 routers/search.py**

```python
import json
import asyncio
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

            yield sse("progress", {"message": f"正在搜索关键词：{', '.join(parsed.keywords)}..."})
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

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@router.get("/download")
async def download(url: str):
    try:
        content, content_type = await fetch_pdf_bytes(url)
        return Response(content=content, media_type="application/pdf",
                        headers={"Content-Disposition": "attachment; filename=paper.pdf"})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"下载失败: {str(e)}")
```

- [ ] **Step 3: 启动后端手动测试 SSE**

```bash
uvicorn main:app --reload --port 8000

# 另开终端，用 curl 测试 SSE（需要真实 DeepSeek key）
curl -X POST http://localhost:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "找 transformer 相关论文", "api_key": "你的真实key"}' \
  --no-buffer
# 预期: 依次看到 event: progress 和 event: done 的 SSE 事件
```

- [ ] **Step 4: 提交**

```bash
git add backend/routers/
git commit -m "feat: SSE search endpoint and PDF download proxy"
```

---

## Task 8: 前端项目初始化

**Files:**
- Create: `frontend/` 目录及所有配置文件

- [ ] **Step 1: 创建 React + Vite + TypeScript 项目**

```bash
cd /path/to/ScholarScout
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

- [ ] **Step 2: 安装依赖**

```bash
npm install tailwindcss @tailwindcss/vite
npm install lucide-react
npm install clsx
```

- [ ] **Step 3: 配置 Tailwind（vite.config.ts）**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000'
    }
  }
})
```

- [ ] **Step 4: 配置 src/index.css**

```css
@import "tailwindcss";
```

- [ ] **Step 5: 验证前端能跑起来**

```bash
npm run dev
# 访问 http://localhost:5173 看到默认 Vite 页面即成功
```

- [ ] **Step 6: 提交**

```bash
git add frontend/
git commit -m "feat: frontend Vite + React + Tailwind setup"
```

---

## Task 9: TypeScript 类型 + API 客户端

**Files:**
- Create: `frontend/src/types/index.ts`
- Create: `frontend/src/api/client.ts`

- [ ] **Step 1: 定义类型 types/index.ts**

```typescript
export interface Paper {
  paper_id: string
  title: string
  authors: string[]
  abstract?: string
  published_date?: string
  doi?: string
  pdf_url?: string
  url?: string
  source: string
  citations: number
  relevance_reason?: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  papers?: Paper[]
  isLoading?: boolean
}

export type SearchProgressEvent = {
  type: 'progress'
  message: string
}

export type SearchDoneEvent = {
  type: 'done'
  papers: Paper[]
  message: string
}

export type SearchErrorEvent = {
  type: 'error'
  message: string
}

export type SearchEvent = SearchProgressEvent | SearchDoneEvent | SearchErrorEvent
```

- [ ] **Step 2: 实现 API 客户端 api/client.ts**

```typescript
import type { SearchEvent } from '../types'

const API_BASE = '/api'

export async function* searchPapers(
  query: string,
  apiKey: string
): AsyncGenerator<SearchEvent> {
  const response = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, api_key: apiKey }),
  })

  if (!response.ok) throw new Error(`请求失败: ${response.status}`)
  if (!response.body) throw new Error('响应无内容')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const eventLine = block.split('\n').find(l => l.startsWith('event:'))
      const dataLine = block.split('\n').find(l => l.startsWith('data:'))
      if (!eventLine || !dataLine) continue

      const eventType = eventLine.replace('event:', '').trim()
      const data = JSON.parse(dataLine.replace('data:', '').trim())
      yield { type: eventType, ...data } as SearchEvent
    }
  }
}

export function getDownloadUrl(pdfUrl: string): string {
  return `${API_BASE}/download?url=${encodeURIComponent(pdfUrl)}`
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/types/ frontend/src/api/
git commit -m "feat: TypeScript types and SSE API client"
```

---

## Task 10: Key 管理 + Key 输入页

**Files:**
- Create: `frontend/src/hooks/useApiKey.ts`
- Create: `frontend/src/components/KeySetupScreen.tsx`

- [ ] **Step 1: useApiKey.ts**

```typescript
import { useState } from 'react'

const STORAGE_KEY = 'scholarscout_deepseek_key'

export function useApiKey() {
  const [apiKey, setApiKeyState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? ''
  )

  const setApiKey = (key: string) => {
    localStorage.setItem(STORAGE_KEY, key)
    setApiKeyState(key)
  }

  const clearApiKey = () => {
    localStorage.removeItem(STORAGE_KEY)
    setApiKeyState('')
  }

  return { apiKey, setApiKey, clearApiKey, hasKey: apiKey.length > 0 }
}
```

- [ ] **Step 2: KeySetupScreen.tsx**

```tsx
import { useState } from 'react'

interface Props {
  onKeySubmit: (key: string) => void
}

export function KeySetupScreen({ onKeySubmit }: Props) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed.startsWith('sk-')) {
      setError('Key 格式不正确，应以 sk- 开头')
      return
    }
    onKeySubmit(trimmed)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">ScholarScout</h1>
        <p className="text-gray-500 mb-6 text-sm">AI 驱动的学术论文搜索工具</p>

        <label className="block text-sm font-medium text-gray-700 mb-2">
          DeepSeek API Key
        </label>
        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="sk-xxxxxxxxxxxxxxxx"
          className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-1"
        />
        {error && <p className="text-red-500 text-xs mb-3">{error}</p>}

        <button
          onClick={handleSubmit}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium mt-3 transition-colors"
        >
          开始使用
        </button>

        <p className="text-xs text-gray-400 mt-4 text-center">
          Key 仅保存在本地浏览器，不会上传到服务器。
          <a href="https://platform.deepseek.com" target="_blank" className="text-blue-500 ml-1">
            没有 Key？点此注册
          </a>
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/hooks/ frontend/src/components/KeySetupScreen.tsx
git commit -m "feat: API key setup screen with localStorage"
```

---

## Task 11: 论文卡片组件

**Files:**
- Create: `frontend/src/components/PaperCard.tsx`
- Create: `frontend/src/components/ResultsPanel.tsx`

- [ ] **Step 1: PaperCard.tsx**

```tsx
import type { Paper } from '../types'
import { getDownloadUrl } from '../api/client'

interface Props {
  paper: Paper
}

export function PaperCard({ paper }: Props) {
  const year = paper.published_date?.slice(0, 4) ?? '未知年份'
  const authorStr = paper.authors.slice(0, 3).join(', ') +
    (paper.authors.length > 3 ? ' 等' : '')

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
            {paper.title}
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            {authorStr} · {year} · {paper.source}
            {paper.citations > 0 && ` · 被引 ${paper.citations}`}
          </p>
        </div>
      </div>

      {paper.abstract && (
        <p className="text-xs text-gray-600 mt-2 line-clamp-3 leading-relaxed">
          {paper.abstract}
        </p>
      )}

      {paper.relevance_reason && (
        <p className="text-xs text-blue-600 mt-2 bg-blue-50 rounded px-2 py-1">
          相关性：{paper.relevance_reason}
        </p>
      )}

      <div className="flex gap-2 mt-3">
        {paper.url && (
          <a
            href={paper.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded-md px-3 py-1 transition-colors"
          >
            查看原文
          </a>
        )}
        {paper.pdf_url && (
          <a
            href={getDownloadUrl(paper.pdf_url)}
            download
            className="text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1 transition-colors"
          >
            下载 PDF
          </a>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: ResultsPanel.tsx**

```tsx
import type { Paper } from '../types'
import { PaperCard } from './PaperCard'

interface Props {
  papers: Paper[]
  isLoading: boolean
  statusMessage: string
}

export function ResultsPanel({ papers, isLoading, statusMessage }: Props) {
  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="text-sm font-semibold text-gray-700">搜索结果</h2>
        {statusMessage && (
          <p className="text-xs text-gray-500 mt-0.5">{statusMessage}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {isLoading && papers.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">
            <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full mr-2" />
            搜索中...
          </div>
        )}

        {!isLoading && papers.length === 0 && statusMessage && (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">
            暂无结果，请描述您想找的论文
          </div>
        )}

        {papers.map(paper => (
          <PaperCard key={paper.paper_id} paper={paper} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/PaperCard.tsx frontend/src/components/ResultsPanel.tsx
git commit -m "feat: paper card and results panel components"
```

---

## Task 12: 对话面板 + 搜索 Hook

**Files:**
- Create: `frontend/src/hooks/useSearch.ts`
- Create: `frontend/src/components/MessageBubble.tsx`
- Create: `frontend/src/components/ChatPanel.tsx`

- [ ] **Step 1: useSearch.ts**

```typescript
import { useState } from 'react'
import { searchPapers } from '../api/client'
import type { Message, Paper } from '../types'

export function useSearch(apiKey: string) {
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'assistant', content: '您好！请描述您想搜索的论文，例如：\n"找2023年后关于大模型幻觉问题的论文"' }
  ])
  const [papers, setPapers] = useState<Paper[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  const addMessage = (msg: Message) =>
    setMessages(prev => [...prev, msg])

  const search = async (query: string) => {
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: query }
    addMessage(userMsg)
    setIsLoading(true)
    setPapers([])

    const assistantId = (Date.now() + 1).toString()
    addMessage({ id: assistantId, role: 'assistant', content: '正在处理...', isLoading: true })

    try {
      for await (const event of searchPapers(query, apiKey)) {
        if (event.type === 'progress') {
          setStatusMessage(event.message)
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: event.message } : m
          ))
        } else if (event.type === 'done') {
          setPapers(event.papers)
          setStatusMessage(event.message)
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: event.message, isLoading: false, papers: event.papers } : m
          ))
        } else if (event.type === 'error') {
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, content: `错误：${event.message}`, isLoading: false } : m
          ))
        }
      }
    } catch (e) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: '网络错误，请稍后重试', isLoading: false } : m
      ))
    } finally {
      setIsLoading(false)
    }
  }

  return { messages, papers, isLoading, statusMessage, search }
}
```

- [ ] **Step 2: MessageBubble.tsx**

```tsx
import type { Message } from '../types'

interface Props {
  message: Message
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
        isUser
          ? 'bg-blue-600 text-white rounded-br-sm'
          : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
      }`}>
        {message.isLoading ? (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        ) : (
          <span className="whitespace-pre-line">{message.content}</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: ChatPanel.tsx**

```tsx
import { useState, useRef, useEffect } from 'react'
import type { Message } from '../types'
import { MessageBubble } from './MessageBubble'

interface Props {
  messages: Message[]
  isLoading: boolean
  onSearch: (query: string) => void
  onClearKey: () => void
}

export function ChatPanel({ messages, isLoading, onSearch, onClearKey }: Props) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const q = input.trim()
    if (!q || isLoading) return
    setInput('')
    onSearch(q)
  }

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h1 className="text-base font-bold text-gray-800">ScholarScout</h1>
        <button onClick={onClearKey} className="text-xs text-gray-400 hover:text-gray-600">
          更换 Key
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="描述您想找的论文，按 Enter 搜索..."
            disabled={isLoading}
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-xl px-4 py-2 text-sm transition-colors"
          >
            搜索
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/hooks/useSearch.ts frontend/src/components/
git commit -m "feat: chat panel, message bubble, search hook"
```

---

## Task 13: 整合 App.tsx + MainLayout

**Files:**
- Create: `frontend/src/components/MainLayout.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: MainLayout.tsx**

```tsx
import { ChatPanel } from './ChatPanel'
import { ResultsPanel } from './ResultsPanel'
import { useSearch } from '../hooks/useSearch'

interface Props {
  apiKey: string
  onClearKey: () => void
}

export function MainLayout({ apiKey, onClearKey }: Props) {
  const { messages, papers, isLoading, statusMessage, search } = useSearch(apiKey)

  return (
    <div className="h-screen flex">
      <div className="w-96 flex-shrink-0">
        <ChatPanel
          messages={messages}
          isLoading={isLoading}
          onSearch={search}
          onClearKey={onClearKey}
        />
      </div>
      <div className="flex-1 min-w-0">
        <ResultsPanel
          papers={papers}
          isLoading={isLoading}
          statusMessage={statusMessage}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: App.tsx**

```tsx
import { KeySetupScreen } from './components/KeySetupScreen'
import { MainLayout } from './components/MainLayout'
import { useApiKey } from './hooks/useApiKey'

export default function App() {
  const { apiKey, setApiKey, clearApiKey, hasKey } = useApiKey()

  if (!hasKey) {
    return <KeySetupScreen onKeySubmit={setApiKey} />
  }

  return <MainLayout apiKey={apiKey} onClearKey={clearApiKey} />
}
```

- [ ] **Step 3: 端到端手动测试**

```bash
# 终端1: 启动后端
cd backend && uvicorn main:app --reload --port 8000

# 终端2: 启动前端
cd frontend && npm run dev

# 浏览器访问 http://localhost:5173
# 1. 输入 DeepSeek Key → 进入主界面
# 2. 输入"找2023年后RAG相关的论文" → 看到进度更新 → 看到论文卡片
# 3. 点击"查看原文" → 新标签打开论文
# 4. 点击"下载 PDF" → 触发下载
# 5. 点击"更换 Key" → 回到 Key 输入页
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/
git commit -m "feat: complete frontend integration"
```

---

## Task 14: 部署到云服务器

**Files:**
- Create: `deploy/nginx.conf`
- Create: `deploy/scholarscout-backend.service`

- [ ] **Step 1: 创建 nginx.conf**

```nginx
server {
    listen 80;
    server_name 118.25.192.117;

    # 前端静态文件
    root /var/www/scholarscout;
    index index.html;

    # 前端路由（React SPA）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 反代
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;

        # SSE 必须的配置
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 120s;
        chunked_transfer_encoding on;
    }
}
```

- [ ] **Step 2: 创建 systemd 服务文件**

```ini
# deploy/scholarscout-backend.service
[Unit]
Description=ScholarScout Backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/ScholarScout/backend
ExecStart=/home/ubuntu/ScholarScout/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: 服务器上的部署步骤**

在服务器 `118.25.192.117` 上依次执行：

```bash
# 1. 克隆代码
git clone https://github.com/Dshuishui/ScholarScout.git
cd ScholarScout

# 2. 安装后端依赖
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 3. 构建前端
cd ../frontend
npm install
npm run build
# 生成 frontend/dist/ 目录

# 4. 部署前端静态文件
sudo mkdir -p /var/www/scholarscout
sudo cp -r frontend/dist/* /var/www/scholarscout/

# 5. 配置 Nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/scholarscout
sudo ln -s /etc/nginx/sites-available/scholarscout /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. 启动后端服务
sudo cp deploy/scholarscout-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable scholarscout-backend
sudo systemctl start scholarscout-backend

# 7. 验证
curl http://118.25.192.117/          # 应返回前端 HTML
curl http://118.25.192.117/api/docs  # 应返回 FastAPI Swagger（404 正常，/docs 不在 /api 前缀下）
```

- [ ] **Step 4: 最终验证**

浏览器访问 `http://118.25.192.117`，走完完整流程：
- Key 输入 → 进入主界面 → 输入查询 → 看到进度 → 看到论文 → 下载 PDF

- [ ] **Step 5: 提交**

```bash
git add deploy/
git commit -m "feat: nginx and systemd deployment config"
git push origin master
```

---

## 功能范围说明（V1 边界）

| 功能 | V1 | 未来版本 |
|---|---|---|
| 搜索源 | arXiv + Semantic Scholar + OpenAlex | 可扩展更多 |
| LLM | DeepSeek | 可扩展其他 |
| 历史记录 | 仅本次会话（localStorage） | 持久化存储 |
| 下载 | 单篇 PDF | 批量 ZIP |
| 认证 | Key 即身份 | 账号体系 |
| HTTPS | 无（IP 访问） | 绑定域名后加 |
| 界面语言 | 中文 | — |
