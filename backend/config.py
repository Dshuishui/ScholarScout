DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-chat"
SEARCH_SOURCES = ["arxiv", "semantic_scholar", "openalex"]
SEARCH_LIMIT_PER_SOURCE = 50   # 每个数据源最多取多少篇原始结果
VALIDATED_LIMIT = 50           # LLM 过滤后最多展示多少篇
CORS_ORIGINS = ["*"]
