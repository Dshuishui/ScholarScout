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
JWT_SECRET = _os.environ.get("JWT_SECRET", "dev-only-secret-change-me-in-production")

# 服务器端 DeepSeek Key（订阅推送的 AI 筛选用，非用户 Key）
DEEPSEEK_API_KEY = _os.environ.get("DEEPSEEK_API_KEY", "")
# 新用户邮箱验证后赠送的免费搜索额度（系统 Key 代付）
DEEPSEEK_SYSTEM_KEY = _os.environ.get("DEEPSEEK_SYSTEM_KEY", "")
FREE_SEARCHES_QUOTA = int(_os.environ.get("FREE_SEARCHES_QUOTA", "3"))
# 未登录访客的免费体验（同样由系统 Key 代付）：
# 每个浏览器共 N 次；同一 IP 24 小时内最多 M 次（防止换浏览器反复领）；全站 24 小时内最多 CAP 次（费用上限）
# 按 IP 的上限不能太低：国内手机网络和校园网大量用户共用出口 IP，设成个位数会误伤正常访客
ANON_TRIAL_SEARCHES = int(_os.environ.get("ANON_TRIAL_SEARCHES", "2"))
ANON_TRIAL_PER_IP_DAY = int(_os.environ.get("ANON_TRIAL_PER_IP_DAY", "20"))
ANON_TRIAL_DAILY_CAP = int(_os.environ.get("ANON_TRIAL_DAILY_CAP", "200"))
# 备份状态文件：deploy/backup.sh 每次成功后写入时间戳，健康检查发现太久没成功就告警。
# 留空表示没有配置备份，不检查。
BACKUP_STATUS_FILE = _os.environ.get("BACKUP_STATUS_FILE", "")
BACKUP_MAX_AGE_HOURS = int(_os.environ.get("BACKUP_MAX_AGE_HOURS", "36"))

# 免费论文对话（系统 Key 代付）：未登录按浏览器计，登录按账号计，全站每天有总量上限。
# 单条对话会截断上下文并限制输出长度，控制单次成本。
ANON_FREE_CHATS = int(_os.environ.get("ANON_FREE_CHATS", "10"))
ACCOUNT_FREE_CHATS = int(_os.environ.get("ACCOUNT_FREE_CHATS", "30"))
ANON_CHAT_PER_IP_DAY = int(_os.environ.get("ANON_CHAT_PER_IP_DAY", "60"))
CHAT_DAILY_CAP = int(_os.environ.get("CHAT_DAILY_CAP", "500"))
FREE_CHAT_MAX_TOKENS = int(_os.environ.get("FREE_CHAT_MAX_TOKENS", "900"))
FREE_CHAT_CONTEXT_CHARS = int(_os.environ.get("FREE_CHAT_CONTEXT_CHARS", "6000"))
# 订阅推送的论文解读：用最强的模型读全文（拿不到全文时读摘要），每篇只生成一次并缓存
PUSH_ANALYSIS_MODEL = _os.environ.get("PUSH_ANALYSIS_MODEL", "deepseek-v4-pro")
PUSH_ANALYSIS_MAX_CHARS = int(_os.environ.get("PUSH_ANALYSIS_MAX_CHARS", "60000"))
# DeepSeek 余额低于这个数（元）时给站长发告警：余额耗尽后搜索筛选、免费对话、订阅解读都会失败
DEEPSEEK_BALANCE_ALERT_CNY = float(_os.environ.get("DEEPSEEK_BALANCE_ALERT_CNY", "20"))

# 标题翻译（系统 Key 代付，不占用户额度）：全站每天最多翻译多少批
TRANSLATE_DAILY_CAP = int(_os.environ.get("TRANSLATE_DAILY_CAP", "300"))

# 站长邮箱：接收新留言通知和运维告警（数据源失效、订阅停推）
ADMIN_EMAIL = _os.environ.get("ADMIN_EMAIL", "dyucong@email.ncu.edu.cn")
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
