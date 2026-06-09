"""
Semantic vector indexing and retrieval using ChromaDB.

Papers (title + abstract) are embedded with ChromaDB's default ONNX model
(no external API key required). The collection persists to disk at ./chroma_db/.
"""
import os
import logging
from typing import Optional

import chromadb
from chromadb.utils.embedding_functions import ONNXMiniLM_L6_V2

logger = logging.getLogger(__name__)

CHROMA_DIR = os.path.join(os.path.dirname(__file__), "..", "chroma_db")
COLLECTION_NAME = "papers"
_client: Optional[chromadb.PersistentClient] = None
_collection = None


def _get_collection():
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=CHROMA_DIR)
        ef = ONNXMiniLM_L6_V2()
        _collection = _client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def index_papers(papers: list[dict]) -> int:
    """
    Upsert papers into the vector index.
    Each paper dict must have: paper_id, title, source.
    Optional: abstract, authors, published_date, citations.
    Returns the number of papers indexed.
    """
    if not papers:
        return 0

    col = _get_collection()
    docs, ids, metas = [], [], []

    for p in papers:
        pid = str(p.get("paper_id", ""))
        if not pid:
            continue
        title = p.get("title") or ""
        abstract = p.get("abstract") or ""
        text = f"{title}. {abstract}".strip()
        if not text:
            continue

        docs.append(text)
        ids.append(pid)
        metas.append({
            "title": title[:500],
            "source": str(p.get("source") or ""),
            "year": str((p.get("published_date") or "")[:4]),
            "citations": int(p.get("citations") or 0),
            "authors": ", ".join((p.get("authors") or [])[:3]),
        })

    if not docs:
        return 0

    try:
        col.upsert(documents=docs, ids=ids, metadatas=metas)
        return len(docs)
    except Exception as e:
        logger.warning("ChromaDB upsert failed: %s", e)
        return 0


def semantic_search(query: str, n_results: int = 10) -> list[dict]:
    """
    Search the index by natural-language query.
    Returns a list of dicts with id, title, source, distance, etc.
    """
    col = _get_collection()
    try:
        results = col.query(
            query_texts=[query],
            n_results=min(n_results, max(1, col.count())),
            include=["documents", "metadatas", "distances"],
        )
    except Exception as e:
        logger.warning("ChromaDB query failed: %s", e)
        return []

    hits = []
    ids = results["ids"][0]
    metas = results["metadatas"][0]
    distances = results["distances"][0]

    for pid, meta, dist in zip(ids, metas, distances):
        hits.append({
            "paper_id": pid,
            "title": meta.get("title", ""),
            "source": meta.get("source", ""),
            "year": meta.get("year", ""),
            "citations": meta.get("citations", 0),
            "authors": meta.get("authors", ""),
            "similarity": round(1 - dist, 4),  # cosine distance → similarity
        })

    return hits


def find_similar(paper_id: str, n_results: int = 5) -> list[dict]:
    """
    Find papers similar to the paper identified by paper_id.
    Returns empty list if the paper hasn't been indexed.
    """
    col = _get_collection()
    try:
        doc = col.get(ids=[paper_id], include=["documents"])
        if not doc["documents"]:
            return []
        text = doc["documents"][0]
    except Exception:
        return []

    try:
        results = col.query(
            query_texts=[text],
            n_results=min(n_results + 1, max(1, col.count())),
            include=["metadatas", "distances"],
        )
    except Exception as e:
        logger.warning("ChromaDB similar query failed: %s", e)
        return []

    hits = []
    for pid, meta, dist in zip(
        results["ids"][0], results["metadatas"][0], results["distances"][0]
    ):
        if pid == paper_id:
            continue
        hits.append({
            "paper_id": pid,
            "title": meta.get("title", ""),
            "source": meta.get("source", ""),
            "year": meta.get("year", ""),
            "citations": meta.get("citations", 0),
            "authors": meta.get("authors", ""),
            "similarity": round(1 - dist, 4),
        })

    return hits[:n_results]


def collection_count() -> int:
    try:
        return _get_collection().count()
    except Exception:
        return 0
