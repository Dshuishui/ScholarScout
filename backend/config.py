import os
from dotenv import load_dotenv

load_dotenv()  # 自动加载 backend/.env 文件（本地开发用）

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-v4-flash"
KIMI_BASE_URL = "https://api.moonshot.cn/v1"
KIMI_MODEL = "moonshot-v1-8k"
KIMI_API_KEY = os.environ.get("KIMI_API_KEY", "")
SEARCH_SOURCES = ["arxiv", "semantic_scholar", "openalex", "pubmed", "core", "inspire", "europepmc", "nasa_ads", "crossref"]
CORE_API_KEY = os.environ.get("CORE_API_KEY", "")
NASA_ADS_API_KEY = os.environ.get("NASA_ADS_API_KEY", "")
SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
# OpenAlex 2026 年起生产环境需要 key（免费，每天 1 美元额度）；无 key 时每天只有 0.1 美元。
# 配置后同时启用 OpenAlex 语义检索
OPENALEX_API_KEY = os.environ.get("OPENALEX_API_KEY", "")
# Semantic Scholar 无 key 时和全世界共用一个限流池，几乎一直 429；免费申请的 key 有独立额度
SEMANTIC_SCHOLAR_API_KEY = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "")
SEMANTIC_SCHOLAR_HEADERS = {"x-api-key": SEMANTIC_SCHOLAR_API_KEY} if SEMANTIC_SCHOLAR_API_KEY else {}
POLITE_EMAIL = "sasakinakamura9@gmail.com"  # 用于 CrossRef / OpenAlex / Unpaywall 礼貌池标识
SEARCH_LIMIT_PER_SOURCE = 50
VALIDATED_LIMIT = 50

import os as _os
JWT_SECRET = _os.environ.get("JWT_SECRET", "dev-secret-change-in-production")

# 服务器端 DeepSeek Key（订阅推送的 AI 筛选用，非用户 Key）
DEEPSEEK_API_KEY = _os.environ.get("DEEPSEEK_API_KEY", "")
# 新用户邮箱验证后赠送的免费搜索额度（系统 Key 代付）
DEEPSEEK_SYSTEM_KEY = _os.environ.get("DEEPSEEK_SYSTEM_KEY", "")
FREE_SEARCHES_QUOTA = int(_os.environ.get("FREE_SEARCHES_QUOTA", "3"))
# 前端地址（邮件验证链接用）
APP_BASE_URL = _os.environ.get("APP_BASE_URL", "http://118.25.192.117")
# 允许跨域调用 API 的来源。前端经 nginx 同源访问，本身不需要跨域；
# 以前是 "*"，任何网站都能在用户浏览器里直接调用我们的接口（包括下载代理）。
# 多个来源用逗号分隔；本地开发走 Vite 代理也是同源，一般不用配。
CORS_ORIGINS = [
    o.strip() for o in _os.environ.get("CORS_ORIGINS", APP_BASE_URL).split(",") if o.strip()
]

# SMTP 配置（QQ 邮箱）：smtp.qq.com:465，密码为授权码
SMTP_HOST = _os.environ.get("SMTP_HOST", "smtp.qq.com")
SMTP_PORT = int(_os.environ.get("SMTP_PORT", "465"))
SMTP_USER = _os.environ.get("SMTP_USER", "")   # 发件人 QQ 邮箱
SMTP_PASS = _os.environ.get("SMTP_PASS", "")   # QQ 邮箱授权码
SMTP_FROM_NAME = _os.environ.get("SMTP_FROM_NAME", "ScholarScout")
