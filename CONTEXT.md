# ScholarScout 开发上下文

> 给下一个 Claude 实例读的。读完可以无缝接手。

---

## 项目概述

面向非技术用户的学术论文搜索工具。用户输入 DeepSeek API Key，用中文自然语言描述需求，系统搜索真实论文并返回可预览/下载的结果。

- **线上地址**：http://zhenbucuo.online（个人云服务器，开放约一年）
- **服务器**：118.25.192.117，ubuntu 用户，4C4G，仓库在 `/home/ubuntu/Github/ScholarScout`
- **GitHub**：https://github.com/Dshuishui/ScholarScout

---

## 技术架构

```
前端 React + Vite + TypeScript + Tailwind（左右分栏）
后端 Python 3.11 + FastAPI + SSE 流式推送
LLM  DeepSeek API（用户自带 Key，前端 localStorage 存储）
搜索 arXiv（paper-search-mcp）+ Semantic Scholar API + OpenAlex API
部署 Nginx + systemd，ubuntu 用户
```

### 核心流程

1. 用户发消息 → `classify_intent()` 判断搜索/对话
2. 搜索意图 → `parse_query()` 提取关键词 + 时间范围
3. 三源并发搜索，每源最多 50 篇
4. 去重 → `validate_papers()` LLM 过滤相关性
5. SSE 流式返回进度和结果

---

## 关键文件

```
backend/
├── config.py              # SEARCH_LIMIT_PER_SOURCE=50, VALIDATED_LIMIT=15（待改50）
├── models.py              # Paper, SearchRequest, ParsedQuery
├── services/
│   ├── llm_service.py     # classify_intent, parse_query, validate_papers
│   ├── search_service.py  # 三源搜索 + deduplicate
│   └── download_service.py# PDF 代理下载，域名白名单
└── routers/search.py      # SSE /api/search, /api/download

frontend/src/
├── hooks/useSearch.ts     # 搜索状态管理，处理 progress/done/chat/error 事件
├── hooks/useApiKey.ts     # localStorage Key 管理
├── api/client.ts          # SSE 客户端，searchPapers(), getDownloadUrl()
├── types/index.ts         # Paper, Message, SearchEvent 类型
└── components/
    ├── KeySetupScreen.tsx  # 首次 Key 输入页
    ├── MainLayout.tsx      # 左右分栏容器
    ├── ChatPanel.tsx       # 左侧对话区
    ├── ResultsPanel.tsx    # 右侧论文列表
    ├── PaperCard.tsx       # 单篇论文卡片
    └── MessageBubble.tsx   # 对话气泡

deploy/
├── setup.sh               # 首次部署（安装依赖、构建、配置 nginx+systemd）
├── deploy.sh              # 后续更新（pull、build、重启）
├── nginx.conf             # server_name 目前是 IP，待改为域名
└── scholarscout-backend.service  # 含 __REPO_DIR__ 占位符，setup.sh 用 sed 替换
```

---

## 待解决问题（backlog）

详见 `docs/backlog.md`，按优先级：

### Issue 1：搜索结果太少 🔴
- `VALIDATED_LIMIT = 15` 待改为 50（config.py 一行）
- 更深层：年份过滤在客户端，取 50 篇再过滤，2026 年论文本来就少
- 改法：`backend/config.py` 中 `VALIDATED_LIMIT = 15 → 50`

### Issue 2：对话无上下文 🟡
- `classify_intent` 和 chat 回复都只发单条消息给 DeepSeek
- 没有携带历史对话，用户追问时 AI 不知道之前找的是什么
- 改法：在 `llm_service.py` 的 classify_intent 和 chat 回复中加入最近 N 条 messages 参数；前端 useSearch.ts 把 messages 传给后端

### Issue 3：域名配置 🟡
- nginx.conf 的 `server_name` 从 IP 改为 `zhenbucuo.online`
- 改 `deploy/nginx.conf` 一行，推送后服务器执行 `deploy/deploy.sh`

### Issue 4：HTTPS 配置 🟡（依赖 Issue 3）
- 方案：Let's Encrypt + Certbot
- 服务器操作步骤：
  ```bash
  sudo apt install certbot python3-certbot-nginx
  sudo certbot --nginx -d zhenbucuo.online
  # 自动续期已由 certbot 安装时配置
  ```
- nginx.conf 需要加 443 端口配置 + HTTP→HTTPS 跳转

---

## 已完成的主要工作

- [x] 后端完整实现（FastAPI + SSE + LLM 三层）
- [x] 前端完整实现（React 左右分栏，Key 管理，论文卡片）
- [x] 意图识别（搜索 vs 对话分流）
- [x] 部署脚本（setup.sh 首次 + deploy.sh 更新）
- [x] README（徽章、架构图、技术栈表、Roadmap、致谢）
- [x] 已成功部署到云服务器并可访问

---

## 开发约定

- 后端用 `uv`（`uv add` 装包，`uv sync --no-dev` 生产部署）
- 提交前跑 `pytest tests/ -q` 确认 11 个测试通过
- 前端改动后跑 `npm run build` 确认 TypeScript 无错误
- 服务器更新：`bash deploy/deploy.sh`
