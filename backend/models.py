from pydantic import BaseModel, Field
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
    fallback_links: list[dict] = [] # [{"name": "Sci-Hub", "url": "..."}]，无 PDF 时的备用查找入口


class ValidateKeyRequest(BaseModel):
    api_key: str = Field(max_length=200)


class ParsedQuery(BaseModel):
    keywords: list[str]
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    max_results: int = 30
