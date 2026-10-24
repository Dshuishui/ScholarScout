"""MCP 服务（stdio JSON-RPC）的协议处理和两个工具。"""
import json
from unittest.mock import AsyncMock

import pytest

import mcp_server as m
from models import Paper


def _paper(pid, title, score=None, cites=0):
    return Paper(paper_id=pid, title=title, authors=["A", "B", "C", "D"], source="OpenAlex",
                 citations=cites, relevance_score=score, abstract="x" * 900)


async def _call(name, arguments):
    reply = await m.handle({"jsonrpc": "2.0", "id": 7, "method": "tools/call",
                            "params": {"name": name, "arguments": arguments}})
    result = reply["result"]
    text = result["content"][0]["text"]
    return result["isError"], (text if result["isError"] else json.loads(text))


async def test_initialize_negotiates_protocol_version():
    reply = await m.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}})
    assert reply["result"]["protocolVersion"] == "2025-03-26"
    assert reply["result"]["capabilities"] == {"tools": {"listChanged": False}}
    newer = await m.handle({"jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {"protocolVersion": "2099-01-01"}})
    assert newer["result"]["protocolVersion"] == m.PROTOCOL_VERSIONS[0]


async def test_notifications_get_no_reply_and_unknown_methods_error():
    assert await m.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
    reply = await m.handle({"jsonrpc": "2.0", "id": 3, "method": "resources/list"})
    assert reply["error"]["code"] == -32601


async def test_tools_list_exposes_both_tools():
    reply = await m.handle({"jsonrpc": "2.0", "id": 4, "method": "tools/list"})
    assert [t["name"] for t in reply["result"]["tools"]] == ["search_papers", "related_papers"]
    assert all(t["inputSchema"]["type"] == "object" for t in reply["result"]["tools"])


async def test_search_without_llm_key_returns_unscored_candidates(monkeypatch):
    monkeypatch.setattr(m.config, "DEEPSEEK_API_KEY", "")
    monkeypatch.setattr(m.config, "DEEPSEEK_SYSTEM_KEY", "")
    monkeypatch.setattr(m, "search_all_sources", AsyncMock(return_value=[_paper("W1", "Low", cites=1), _paper("W2", "High", cites=99)]))
    is_error, data = await _call("search_papers", {"question": "q", "keywords": ["raft"], "max_results": 1})
    assert not is_error and data["relevance_scored"] is False
    assert [p["title"] for p in data["papers"]] == ["High"]   # 按被引数排，附上摘要让调用方自己判断
    assert len(data["papers"][0]["abstract"]) == 600 and data["papers"][0]["authors"][-1] == "et al."


async def test_search_with_llm_key_scores_and_adds_citation_finds(monkeypatch):
    monkeypatch.setattr(m.config, "DEEPSEEK_API_KEY", "sk-test")
    pool = [_paper("W1", "Seed"), _paper("W2", "Off topic")]
    monkeypatch.setattr(m, "search_all_sources", AsyncMock(return_value=pool))
    monkeypatch.setattr(m, "validate_papers", AsyncMock(return_value=([pool[0].model_copy(update={"relevance_score": 9.0})], [pool[1]])))
    expand = AsyncMock(return_value=[_paper("W3", "Via citations", score=10.0)])
    monkeypatch.setattr(m, "expand_and_validate", expand)
    is_error, data = await _call("search_papers", {"question": "q", "keywords": ["rl"], "concepts": [["rl"], ["guidance"]]})
    assert not is_error
    assert [p["title"] for p in data["papers"]] == ["Via citations", "Seed"]
    assert data["found_via_citations"] == 1 and "abstract" not in data["papers"][0]
    assert expand.await_args.args[2].concepts == [["rl"], ["guidance"]]


async def test_tool_errors_are_reported_in_the_result(monkeypatch):
    is_error, text = await _call("search_papers", {"question": "q", "keywords": []})
    assert is_error and "keywords" in text
    monkeypatch.setattr(m.config, "OPENALEX_API_KEY", "")
    is_error, text = await _call("related_papers", {"paper": "W123"})
    assert is_error and "OPENALEX_API_KEY" in text
    reply = await m.handle({"jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": {"name": "nope"}})
    assert reply["error"]["code"] == -32602


async def test_related_papers_accepts_doi_urls_and_splits_lists(monkeypatch):
    monkeypatch.setattr(m.config, "OPENALEX_API_KEY", "k")
    neighbors = AsyncMock(return_value=([_paper("R1", "Ref")], [_paper("C1", "Citing")]))
    monkeypatch.setattr(m, "citation_neighbors", neighbors)
    is_error, data = await _call("related_papers", {"paper": "https://doi.org/10.1/ABC", "max_results": 3})
    assert not is_error
    assert [p["title"] for p in data["references"]] == ["Ref"] and [p["title"] for p in data["cited_by"]] == ["Citing"]
    seed = neighbors.await_args.args[0][0]
    assert seed.doi == "10.1/ABC" and neighbors.await_args.args[3:] == (3, 3)
