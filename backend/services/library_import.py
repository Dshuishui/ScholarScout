"""从用户导出的文献库（Zotero / EndNote 的 BibTeX、RIS、CSV）归纳研究方向，生成订阅关键词。

zotero-arxiv-daily 靠"直接读你的 Zotero 库"拿到了最多的星：比让用户自己想关键词准得多。
这里只读标题（有年份就优先取最近的），交给大模型归纳成 1-3 组检索关键词；文件本身不保存。
"""
import csv
import io
import json
import re

from openai import AsyncOpenAI

from config import DEEPSEEK_BASE_URL, DEEPSEEK_MODEL

MAX_TITLES = 150
MAX_DIRECTIONS = 3

# booktitle、shorttitle 前面紧挨着字母，不会被当成 title
_BIB_TITLE = re.compile(r"(?<![A-Za-z])title\s*=\s*", re.I)
_BIB_YEAR = re.compile(r"(?<![A-Za-z])(?:year|date)\s*=\s*[{\"]?\s*(\d{4})", re.I)
_LATEX_CMD = re.compile(r"\\[A-Za-z]+\s*")


def _read_bib_value(text: str, start: int) -> str:
    """读 BibTeX 字段值：{...}（可嵌套）或 "..."。"""
    if start >= len(text):
        return ""
    if text[start] == "{":
        depth, i = 0, start
        while i < len(text):
            if text[i] == "{" and text[i - 1] != "\\":
                depth += 1
            elif text[i] == "}" and text[i - 1] != "\\":
                depth -= 1
                if depth == 0:
                    return text[start + 1:i]
            i += 1
        return text[start + 1:]
    if text[start] == '"':
        end = text.find('"', start + 1)
        return text[start + 1:end if end > 0 else None]
    return ""


def _clean(title: str) -> str:
    t = _LATEX_CMD.sub("", title).replace("{", "").replace("}", "").replace("\\", "")
    return re.sub(r"\s+", " ", t).strip()


def _parse_bibtex(text: str) -> list[tuple[str, int]]:
    items = []
    for entry in re.split(r"\n\s*@", "\n" + text)[1:]:
        m = _BIB_TITLE.search(entry)
        if not m:
            continue
        title = _clean(_read_bib_value(entry, m.end()))
        y = _BIB_YEAR.search(entry)
        if title:
            items.append((title, int(y.group(1)) if y else 0))
    return items


def _parse_ris(text: str) -> list[tuple[str, int]]:
    items, title, year = [], "", 0
    for line in text.splitlines():
        tag, _, value = line.partition("  - ")
        tag, value = tag.strip(), value.strip()
        if tag in ("TI", "T1") and not title:
            title = value
        elif tag in ("PY", "Y1", "DA") and not year:
            m = re.match(r"\d{4}", value)
            year = int(m.group()) if m else 0
        elif tag == "ER":
            if title:
                items.append((_clean(title), year))
            title, year = "", 0
    return items


def _parse_csv(text: str) -> list[tuple[str, int]]:
    rows = csv.DictReader(io.StringIO(text))
    fields = {f.lower(): f for f in rows.fieldnames or []}
    title_col = fields.get("title") or fields.get("标题")
    year_col = fields.get("publication year") or fields.get("year") or fields.get("年份")
    if not title_col:
        return []
    items = []
    for row in rows:
        title = (row.get(title_col) or "").strip()
        m = re.match(r"\d{4}", (row.get(year_col) or "") if year_col else "")
        if title:
            items.append((_clean(title), int(m.group()) if m else 0))
    return items


def extract_titles(text: str) -> list[str]:
    """按内容判断格式（不信扩展名），返回去重后的标题，最近的在前，最多 MAX_TITLES 条。"""
    if re.search(r"^\s*@\w+\s*\{", text, re.M):
        items = _parse_bibtex(text)
    elif re.search(r"^TY  - ", text, re.M):
        items = _parse_ris(text)
    else:
        items = _parse_csv(text)
    seen, titles = set(), []
    for title, _ in sorted(items, key=lambda it: it[1], reverse=True):
        key = title.lower()
        if key not in seen:
            seen.add(key)
            titles.append(title)
    return titles[:MAX_TITLES]


SUGGEST_PROMPT = """下面是一位研究者文献库里的论文标题（最近的在前）。请归纳出 TA 最主要的 1-{n} 个研究方向，用来每天订阅这些方向的新论文。

要求：
- 每个方向给一个简短的中文名（≤12 字）和 3-6 个英文学术检索关键词（核心术语在前，加上常见同义词）
- 方向之间不要重复；只出现一两篇的边缘主题不要单列
- 只返回 JSON：{{"directions": [{{"name": "中文名", "keywords": ["english keyword", "..."]}}]}}

标题：
{titles}"""


async def suggest_directions(titles: list[str], api_key: str, model: str = DEEPSEEK_MODEL) -> list[dict]:
    client = AsyncOpenAI(api_key=api_key, base_url=DEEPSEEK_BASE_URL)
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": SUGGEST_PROMPT.format(
            n=MAX_DIRECTIONS, titles="\n".join(f"- {t[:200]}" for t in titles))}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    raw = json.loads(response.choices[0].message.content or "{}")
    directions = []
    for d in raw.get("directions") or []:
        if not isinstance(d, dict):
            continue
        keywords = [k.strip()[:100] for k in d.get("keywords") or [] if isinstance(k, str) and k.strip()][:6]
        if keywords:
            directions.append({"name": str(d.get("name") or keywords[0])[:30], "keywords": keywords})
    return directions[:MAX_DIRECTIONS]
