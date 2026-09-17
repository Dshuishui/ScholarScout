"""订阅推送用的论文深度解读。

推送邮件原来只有一段英文摘要，中文读者很难判断值不值得点开。这里在推送前：
1. 尽量拿到论文全文（只走开放获取渠道），拿不到就退回摘要；
2. 用最强的模型（默认 deepseek-v4-pro）一次性生成中文摘要和结构化解读；
3. 结果写回队列里的论文数据，同一篇只生成一次。

生成失败不影响推送：邮件照常发，只是少了这一块。
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

import openai

import config
from logging_config import get_logger
from models import Paper

logger = get_logger(__name__)

PDF_TIMEOUT_SEC = 60
LLM_TIMEOUT_SEC = 300
# deepseek-v4-pro 是推理模型：先思考再输出，思考用的 token 也计入 max_tokens。
# 读全文做解读时光思考就可能超过 2000，正文输出为空（实际遇到过）。放宽上限，被截断时再加大重试一次。
MAX_OUTPUT_TOKENS = (8000, 16000)
ANALYSIS_KEYS = ("problem", "method", "findings", "limitations", "for_whom")

PROMPT = """你是一位严谨的学术论文解读助手，读者是中文母语的研究生，不一定是这个领域的专家。
请根据下面提供的论文内容，输出 JSON（所有字段都用中文）：
{{
  "abstract_zh": "把英文摘要忠实翻译成通顺的中文；没有英文摘要时根据正文概括，150～250 字",
  "problem": "这篇论文要解决什么问题，为什么值得解决（1～2 句）",
  "method": "作者具体怎么做的：核心方法、数据或实验设计（2～3 句，少用术语，必须用的术语简单解释）",
  "findings": "主要发现和结论，尽量给出关键数字（2～3 句）",
  "limitations": "局限或读的时候要注意的地方（1～2 句；原文看不出来就写"原文未明确说明"）",
  "for_whom": "适合谁读、读完可以怎么用（1 句）"
}}
只根据提供的内容回答，不要编造原文没有的数字或结论。{scope_note}

【标题】{title}
【作者】{authors}
【发表】{venue}
【英文摘要】
{abstract}
{full_text_block}"""


async def _fetch_full_text(paper: Paper) -> Optional[str]:
    """只走开放获取渠道拿全文；拿不到返回 None。"""
    if not paper.pdf_url and not paper.doi:
        return None
    try:
        from services.download_service import fetch_pdf_with_fallback
        from routers.paper import _extract_text
        pdf = await asyncio.wait_for(
            fetch_pdf_with_fallback(paper.pdf_url or "", doi=paper.doi, paper_id=paper.paper_id),
            timeout=PDF_TIMEOUT_SEC,
        )
        text = await asyncio.to_thread(_extract_text, pdf)
        # 太短说明解析出来的基本不是正文（扫描版、只有封面页等）
        return text if text and len(text) > 2000 else None
    except Exception as e:
        logger.info("Full text unavailable for %s: %s", paper.paper_id, e)
        return None


async def analyze_paper(paper: Paper, api_key: str, model: Optional[str] = None,
                        full_text: Optional[str] = None, fetch_full_text: bool = True) -> Optional[dict]:
    """生成中文摘要和结构化解读。返回 {"abstract_zh", "analysis": {...}}，失败返回 None。"""
    if not api_key:
        return None
    model = model or config.PUSH_ANALYSIS_MODEL
    if full_text is None and fetch_full_text:
        full_text = await _fetch_full_text(paper)

    based_on = "full_text" if full_text else "abstract"
    logger.info("Analyzing %s with %s based on %s (%d chars of full text)",
                paper.paper_id, model, based_on, len(full_text or ""))
    if not full_text and not paper.abstract:
        return None  # 连摘要都没有，解读只会是瞎编

    excerpt = (full_text or "")[: config.PUSH_ANALYSIS_MAX_CHARS]
    prompt = PROMPT.format(
        scope_note="" if full_text else "\n注意：这次只拿到了摘要，没有全文，解读要克制，不要推测实验细节。",
        title=paper.title,
        authors="、".join(paper.authors[:6]) or "未知",
        venue=" · ".join(x for x in [paper.venue or "", (paper.published_date or "")[:4]] if x) or "未知",
        abstract=paper.abstract or "（无）",
        full_text_block=f"\n【正文（节选）】\n{excerpt}" if excerpt else "",
    )

    client = openai.AsyncOpenAI(api_key=api_key, base_url=config.DEEPSEEK_BASE_URL)
    data, resp = None, None
    for max_tokens in MAX_OUTPUT_TOKENS:
        try:
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"},
                    temperature=0.2,
                    max_tokens=max_tokens,
                ),
                timeout=LLM_TIMEOUT_SEC,
            )
        except Exception as e:
            logger.warning("Paper analysis request failed for %s: %s", paper.paper_id, e)
            return None
        choice = resp.choices[0]
        data = _parse_json(choice.message.content)
        if data is not None:
            break
        logger.warning("Paper analysis got no usable JSON for %s (finish_reason=%s, max_tokens=%d)",
                       paper.paper_id, choice.finish_reason, max_tokens)
        if choice.finish_reason != "length":
            return None  # 不是被截断，加大上限也没用
    if data is None:
        return None

    analysis = {k: str(data.get(k) or "").strip() for k in ANALYSIS_KEYS}
    if not any(analysis.values()):
        return None
    usage = getattr(resp, "usage", None)
    analysis.update({
        "based_on": based_on,
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "input_tokens": getattr(usage, "prompt_tokens", None),
        "output_tokens": getattr(usage, "completion_tokens", None),
    })
    return {"abstract_zh": str(data.get("abstract_zh") or "").strip() or None, "analysis": analysis}


def _parse_json(content: str | None) -> dict | None:
    """兼容模型偶尔把 JSON 包在 ```json 代码块里的情况。"""
    if not content:
        return None
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    try:
        data = json.loads(text)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


async def ensure_analysis(paper: Paper, api_key: str) -> tuple[Paper, bool]:
    """已有解读直接返回；没有就生成。返回 (论文, 是否新生成)。"""
    if paper.analysis:
        return paper, False
    result = await analyze_paper(paper, api_key)
    if not result:
        return paper, False
    return paper.model_copy(update=result), True
