import os
from dotenv import load_dotenv

load_dotenv()  # 自动加载 backend/.env 文件（本地开发用）

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"
SEARCH_SOURCES = ["arxiv", "semantic_scholar", "openalex", "pubmed", "core", "inspire", "europepmc", "nasa_ads", "crossref"]
CORE_API_KEY = os.environ.get("CORE_API_KEY", "")
NASA_ADS_API_KEY = os.environ.get("NASA_ADS_API_KEY", "")
SERPAPI_KEY = os.environ.get("SERPAPI_KEY", "")
POLITE_EMAIL = "sasakinakamura9@gmail.com"  # 用于 CrossRef / OpenAlex / Unpaywall 礼貌池标识
SEARCH_LIMIT_PER_SOURCE = 50
VALIDATED_LIMIT = 50
CORS_ORIGINS = ["*"]
