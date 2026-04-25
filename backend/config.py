DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"
SEARCH_SOURCES = ["arxiv", "semantic_scholar", "openalex", "pubmed", "core"]
CORE_API_KEY = ""  # 在 https://core.ac.uk/services/api 免费注册获取，留空则跳过 CORE 搜索
SEARCH_LIMIT_PER_SOURCE = 50   # 每个数据源最多取多少篇原始结果
VALIDATED_LIMIT = 50           # LLM 过滤后最多展示多少篇
CORS_ORIGINS = ["*"]
