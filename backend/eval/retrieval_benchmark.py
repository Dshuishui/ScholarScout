"""检索回归测试：检查 golden_queries.json 里的经典论文能不能进入候选池。

不调用大模型（不花钱），只测检索阶段；最终排序由大模型打分决定，所以这里关心的是
"目标论文有没有被搜到"（召回）以及候选池里有多少明显无关的论文（噪音）。

用法（在 backend/ 目录下）：
    uv run python eval/retrieval_benchmark.py                   # 当前代码
    uv run python eval/retrieval_benchmark.py --legacy-5y        # 模拟旧行为：用户没说时间时默认只搜近 5 年
    uv run python eval/retrieval_benchmark.py --only lora,raft   # 只跑部分用例
    uv run python eval/retrieval_benchmark.py --no-domains       # 不按领域选源（查全部数据源）
结果以 JSON 行输出，最后一行是汇总。
"""
import argparse
import asyncio
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import ParsedQuery  # noqa: E402
from services.search_service import search_all_sources  # noqa: E402

GOLDEN = Path(__file__).with_name("golden_queries.json")


def _norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


async def run_case(case: dict, limit: int, legacy_5y: bool, use_domains: bool) -> dict:
    date_from = case["user_date_from"]
    if date_from is None and legacy_5y:
        date_from = f"{date.today().year - 5}-01-01"

    per_source: dict[str, int] = {}

    async def on_done(name: str, count: int) -> None:
        per_source[name] = count

    started = time.monotonic()
    papers = await search_all_sources(
        ParsedQuery(keywords=case["keywords"], date_from=date_from,
                    domains=[case["domain"]] if use_domains else []),
        limit_per_source=limit,
        on_source_done=on_done,
    )
    target = _norm(case["target"])[:45]
    hit = next((p for p in papers if target in _norm(p.title)), None)

    keyword_words = {w for k in case["keywords"] for w in _norm(k).split() if len(w) > 3}
    off_topic = sum(1 for p in papers if not keyword_words & set(_norm(p.title).split()))

    return {
        "id": case["id"],
        "found": hit is not None,
        "found_in": sorted({lk["source"] for lk in (hit.source_links or [])}) if hit else [],
        "pool": len(papers),
        "off_topic_pct": round(100 * off_topic / len(papers)) if papers else 0,
        "empty_sources": sorted(k for k, v in per_source.items() if v == 0),
        "secs": round(time.monotonic() - started, 1),
    }


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50, help="每个源取多少篇（线上默认 50）")
    ap.add_argument("--legacy-5y", action="store_true", help="模拟旧的默认近 5 年时间窗")
    ap.add_argument("--only", default="", help="逗号分隔的用例 id")
    ap.add_argument("--no-domains", action="store_true", help="不按领域选源")
    ap.add_argument("--pause", type=float, default=3.0, help="用例之间的间隔秒数，避免触发限流")
    args = ap.parse_args()

    cases = json.loads(GOLDEN.read_text(encoding="utf-8"))["cases"]
    if args.only:
        wanted = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in wanted]

    results = []
    for i, case in enumerate(cases):
        if i:
            await asyncio.sleep(args.pause)
        r = await run_case(case, args.limit, args.legacy_5y, not args.no_domains)
        results.append(r)
        print(json.dumps(r, ensure_ascii=False), flush=True)

    found = sum(r["found"] for r in results)
    print(json.dumps({
        "summary": True,
        "recall": f"{found}/{len(results)}",
        "missed": [r["id"] for r in results if not r["found"]],
        "avg_pool": round(sum(r["pool"] for r in results) / max(len(results), 1)),
        "avg_off_topic_pct": round(sum(r["off_topic_pct"] for r in results) / max(len(results), 1)),
        "legacy_5y": args.legacy_5y,
        "domains": not args.no_domains,
    }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
