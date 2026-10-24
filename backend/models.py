from pydantic import BaseModel, Field, field_validator
from typing import Optional
from config import SEARCH_LIMIT_PER_SOURCE, VALIDATED_LIMIT


class HistoryMessage(BaseModel):
    role: str = Field(max_length=20)
    content: str = Field(max_length=5000)

class ParseRequest(BaseModel):
    query: str = Field(max_length=2000)
    api_key: Optional[str] = Field(default=None, max_length=200)
    messages: list[HistoryMessage] = Field(default=[], max_length=30)
    model: Optional[str] = Field(default=None, max_length=100)

class SearchRequest(BaseModel):
    query: str = Field(default="", max_length=2000)
    api_key: Optional[str] = Field(default=None, max_length=200)
    messages: list[HistoryMessage] = Field(default=[], max_length=30)
    limit_per_source: int = Field(default=SEARCH_LIMIT_PER_SOURCE, ge=5, le=200)
    validated_limit: int = Field(default=VALIDATED_LIMIT, ge=5, le=500)
    keywords: Optional[list[str]] = Field(default=None, max_length=15)
    date_from: Optional[str] = Field(default=None, max_length=20)
    date_to: Optional[str] = Field(default=None, max_length=20)
    sources: Optional[list[str]] = Field(default=None, max_length=15)
    domains: Optional[list[str]] = Field(default=None, max_length=10)  # parse 阶段识别的学科领域，用于选源
    concepts: Optional[list[list[str]]] = Field(default=None, max_length=10)  # parse 阶段拆出的概念组，用于取交集检索
    model: Optional[str] = Field(default=None, max_length=100)


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
    relevance_reason: Optional[str] = None
    relevance_score: Optional[float] = None
    tldr: Optional[str] = None
    source_links: list[dict] = []   # [{"source": "arXiv", "url": "..."}]
    venue: Optional[str] = None
    fallback_links: list[dict] = [] # [{"name": "Google 学术", "url": "..."}]，无 PDF 时的备用查找入口
    # 订阅推送前由 Pro 模型生成：中文摘要和结构化解读（见 services/paper_analysis.py）
    abstract_zh: Optional[str] = None
    analysis: Optional[dict] = None


class ValidateKeyRequest(BaseModel):
    api_key: str = Field(max_length=200)


MAX_CONCEPT_GROUPS = 3
MAX_TERMS_PER_CONCEPT = 4


class ParsedQuery(BaseModel):
    keywords: list[str]
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    max_results: int = 30
    domains: list[str] = []  # 学科领域，空表示未知（查全部数据源）
    # 需求里要同时满足的几个概念，每组是同一概念的几种英文说法，
    # 如 [["reinforcement learning"], ["missile guidance", "guidance law"]]；空表示不做交集检索
    concepts: list[list[str]] = []

    @field_validator("concepts", mode="before")
    @classmethod
    def _normalize_concepts(cls, v):
        """大模型偶尔把某组写成字符串、返回 null 或给太多组：整理成规整的二维列表，不让整次搜索因为格式报错。"""
        if not isinstance(v, list):
            return []
        groups = []
        for g in v:
            terms = [g] if isinstance(g, str) else g if isinstance(g, list) else []
            terms = [t.strip()[:100] for t in terms if isinstance(t, str) and t.strip()]
            if terms:
                groups.append(terms[:MAX_TERMS_PER_CONCEPT])
        return groups[:MAX_CONCEPT_GROUPS]
