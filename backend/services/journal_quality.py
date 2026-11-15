"""标出收费发表、审稿宽松的"低门槛"出版社，结果里排到后面。

2026-11 用 12 个跨学科中文问题实测：中文结果里有 DOI 的论文，多数来自新加坡、香港注册的小出版社，
办的是《现代教育前沿》《临床医学前沿》这类"国际中文期刊"，收费发表、出刊快。AI 只看相关性，
这些论文常常排在前面。下面的前缀都按 CrossRef 登记的出版社名逐个核对过；不确定的（CrossRef 查不到
出版社的前缀）没有放进来，宁可漏标，也不能把正规期刊错标成低门槛。
"""
import re

# DOI 前缀 → 出版社（CrossRef 登记名）
LOW_TIER_PREFIXES: dict[str, str] = {
    "10.12677": "Hans Publishers（汉斯出版社）",
    "10.4236": "Scientific Research Publishing (SCIRP)",
    "10.37155": "Omniscient Pte Ltd",
    "10.69979": "Singapore Juzhi Journal Publishing",
    "10.32629": "Frontier Scientific Publishing Pte Ltd",
    "10.64216": "Hong Kong Anmai Publishing",
    "10.61369": "Art and Design Press",
    "10.33142": "Viser Technology Pte Ltd",
    "10.62022": "NEM Publishing Company",
    "10.64083": "Academic Education Publishing House Group",
    "10.63887": "Academic Frontiers Publishing Group",
    "10.62989": "Academic Frontiers Publishing Group",
    "10.67328": "Xinlan Culture Limited",
    "10.26549": "Synergy Publishing Pte Ltd",
    "10.36012": "Encyclopaedic Publishing Pte Ltd",
    "10.70693": "Wisvora Publishing",
    "10.71411": "Shiharr Publishing Limited",
    "10.62662": "Science Literature Periodical Press",
    "10.61654": "Zhongzhuo Publishing Group",
    "10.64649": "Hong Kong Yuanhong Publishing House",
    "10.62836": "Global Science Publishing Pte Ltd",
    "10.65976": "Hong Kong Modern Publishers",
    "10.54254": "EWA Publishing",
    "10.64658": "Greater Bay Area Science Press",
    "10.35534": "Sciscan Publishing Limited",
    "10.55375": "Shuangqing Academic Publishing House",
}

# 名单外新冒出来的同类出版社：只有 CrossRef 给出版社名时能兜底识别。只认中文标题的论文，
# 并排除同样注册在新加坡的正规大出版社（Springer Nature Singapore、World Scientific）
_OVERSEAS_SMALL_PUBLISHER = re.compile(r"\bPte\.?\s*Ltd\b|^Hong Kong .*(Publish|Press)", re.I)
_MAJOR_PUBLISHER = re.compile(r"springer|world scientific|elsevier|wiley|taylor|sage|nature", re.I)
_CJK = re.compile(r"[一-鿿]")

# 排序时扣的分：AI 打 9 分的低门槛论文排在 7 分的普通论文后面
LOW_TIER_PENALTY = 2.0


def low_tier_publisher(doi: str | None, title: str = "", publisher: str | None = None) -> str | None:
    """是低门槛出版社就返回出版社名，否则 None。"""
    prefix = (doi or "").split("/")[0].strip().lower()
    if prefix in LOW_TIER_PREFIXES:
        return LOW_TIER_PREFIXES[prefix]
    if (publisher and _CJK.search(title or "") and _OVERSEAS_SMALL_PUBLISHER.search(publisher)
            and not _MAJOR_PUBLISHER.search(publisher)):
        return publisher.strip()
    return None
