"""从 Zotero / EndNote 导出的文献库归纳订阅方向。"""
from unittest.mock import AsyncMock, patch

import pytest

from services.library_import import extract_titles
from tests.conftest import make_verified_user

BIB = r"""
@article{a2019,
  title = {Deep {Reinforcement} Learning for \textit{Missile} Guidance},
  booktitle = {Should Not Be Picked},
  year = {2019},
}
@inproceedings{b2023,
  author = "X and Y",
  title = "Adaptive Dynamic Programming Guidance Law",
  date = {2023-05},
}
@misc{dup,
  TITLE = {deep reinforcement learning for missile guidance},
  year = 2018
}
"""

RIS = "TY  - JOUR\r\nTI  - Radar Absorbing Structures\r\nPY  - 2021\r\nER  - \r\n\r\nTY  - JOUR\r\nT1  - Stealth Composites Review\r\nY1  - 2024/01/02\r\nER  - \r\n"

CSV = '"Key","Item Type","Publication Year","Author","Title"\n"K1","journalArticle","2020","A","Metamorphic Testing of Routers"\n"K2","journalArticle","2022","B","Conformance Testing, Revisited"\n'


def test_extract_titles_from_bibtex_newest_first_and_deduped():
    assert extract_titles(BIB) == [
        "Adaptive Dynamic Programming Guidance Law",
        "Deep Reinforcement Learning for Missile Guidance",
    ]


def test_extract_titles_from_ris_and_zotero_csv():
    assert extract_titles(RIS) == ["Stealth Composites Review", "Radar Absorbing Structures"]
    assert extract_titles(CSV) == ["Conformance Testing, Revisited", "Metamorphic Testing of Routers"]


def test_extract_titles_ignores_unknown_text():
    assert extract_titles("just some notes\nwithout any titles") == []


async def _headers(db_session):
    _, token = await make_verified_user(db_session, email="lib@test.com")
    return {"Authorization": f"Bearer {token}"}


def _upload(text: str, name="library.bib"):
    return {"file": (name, text.encode("utf-8"), "application/octet-stream")}


@pytest.mark.asyncio
async def test_suggest_from_library_returns_directions(client, db_session, monkeypatch):
    import config
    monkeypatch.setattr(config, "DEEPSEEK_SYSTEM_KEY", "sk-system")
    headers = await _headers(db_session)
    directions = [{"name": "强化学习制导", "keywords": ["reinforcement learning", "missile guidance"]}]
    fake = AsyncMock(return_value=directions)
    with patch("routers.subscriptions.suggest_directions", new=fake):
        extra = "@article{c, title={Guidance Laws with Impact Angle Constraints}, year={2020}}\n"
        r = await client.post("/api/subscriptions/suggest-from-library", files=_upload(BIB + extra), headers=headers)
    assert r.status_code == 200, r.text
    assert r.json() == {"titles": 3, "directions": directions}
    assert fake.await_args.args[0][0] == "Adaptive Dynamic Programming Guidance Law"


@pytest.mark.asyncio
async def test_suggest_from_library_rejects_files_without_titles(client, db_session, monkeypatch):
    import config
    monkeypatch.setattr(config, "DEEPSEEK_SYSTEM_KEY", "sk-system")
    headers = await _headers(db_session)
    fake = AsyncMock()
    with patch("routers.subscriptions.suggest_directions", new=fake):
        r = await client.post("/api/subscriptions/suggest-from-library", files=_upload("hello"), headers=headers)
    assert r.status_code == 400
    assert "导出条目" in r.json()["detail"]
    fake.assert_not_awaited()


@pytest.mark.asyncio
async def test_suggest_from_library_requires_login(client):
    r = await client.post("/api/subscriptions/suggest-from-library", files=_upload(BIB))
    assert r.status_code == 401
