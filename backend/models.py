from pydantic import BaseModel, Field
from typing import Optional
from config import SEARCH_LIMIT_PER_SOURCE, VALIDATED_LIMIT


class HistoryMessage(BaseModel):
    role: str
    content: str

class ParseRequest(BaseModel):
    query: str
    api_key: str
    messages: list[HistoryMessage] = []

class SearchRequest(BaseModel):
    query: str
    api_key: str
    messages: list[HistoryMessage] = []
    limit_per_source: int = Field(default=SEARCH_LIMIT_PER_SOURCE, ge=5, le=200)
    validated_limit: int = Field(default=VALIDATED_LIMIT, ge=5, le=500)
    # 若前端传入已确认的关键词，跳过 parse_query
    keywords: Optional[list[str]] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


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


class ParsedQuery(BaseModel):
    keywords: list[str]
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    max_results: int = 30
