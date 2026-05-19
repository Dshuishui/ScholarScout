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
# 服务器代理地址，scholarly 用此绕过 Google Scholar 封锁，例如 http://127.0.0.1:7890
PROXY_URL = (os.environ.get("PROXY_URL")
             or os.environ.get("HTTP_PROXY")
             or os.environ.get("http_proxy")
             or "")
POLITE_EMAIL = "sasakinakamura9@gmail.com"  # 用于 CrossRef / OpenAlex / Unpaywall 礼貌池标识
SEARCH_LIMIT_PER_SOURCE = 50
VALIDATED_LIMIT = 50
CORS_ORIGINS = ["*"]

import os as _os
JWT_SECRET = _os.environ.get("JWT_SECRET", "dev-secret-change-in-production")

# 服务器端 DeepSeek Key（订阅推送的 AI 筛选用，非用户 Key）
DEEPSEEK_API_KEY = _os.environ.get("DEEPSEEK_API_KEY", "")

# SMTP 配置（QQ 邮箱）：smtp.qq.com:465，密码为授权码
SMTP_HOST = _os.environ.get("SMTP_HOST", "smtp.qq.com")
SMTP_PORT = int(_os.environ.get("SMTP_PORT", "465"))
SMTP_USER = _os.environ.get("SMTP_USER", "")   # 发件人 QQ 邮箱
SMTP_PASS = _os.environ.get("SMTP_PASS", "")   # QQ 邮箱授权码
SMTP_FROM_NAME = _os.environ.get("SMTP_FROM_NAME", "ScholarScout")
