from pydantic import BaseModel
from typing import Optional


class SearchRequest(BaseModel):
    query: str
    api_key: str


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
