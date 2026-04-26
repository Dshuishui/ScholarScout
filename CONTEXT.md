# ScholarScout 开发上下文

> 给下一个 Claude 实例读的。读完可以无缝接手。

---

## 项目概述

面向非技术用户的学术论文搜索工具。用户输入 DeepSeek API Key，用中文自然语言描述需求，系统搜索真实论文并返回可预览/下载的结果。

- **线上地址**：http://118.25.192.117（个人云服务器，开放约至 2027 年初）
- **服务器**：118.25.192.117，ubuntu 用户，4C4G，仓库在 `/home/ubuntu/Github/ScholarScout`
- **GitHub**：https://github.com/Dshuishui/ScholarScout

---

## 技术架构

```
前端 React + Vite + TypeScript + Tailwind（左右分栏）
后端 Python 3.11 + FastAPI + SSE 流式推送
LLM  DeepSeek API（用户自带 Key，前端 localStorage 存储）
搜索 10 个数据源并发 + Unpaywall PDF 补全
部署 Nginx + systemd，ubuntu 用户
```

### 搜索源（10 个）

| 源 | 需要 Key | 领域 |
|---|---|---|
| arXiv | 否 | CS / 物理 / 数学 |
| Semantic Scholar | 否（有 Key 可提升限速） | 综合 |
| OpenAlex | 否 | 综合，2 亿+ |
| PubMed | 否 | 医学 / 生物 |
| Europe PMC | 否 | 生命科学 + bioRxiv/medRxiv |
| INSPIRE-HEP | 否 | 高能物理 / 粒子物理 |
| CrossRef | 否 | 综合，1.5 亿+，人文/工程 |
| CORE | 是（免费） | 1.7 亿+ 开放获取 |
| NASA ADS | 是（免费） | 天文 / 天体物理 |
| Google Scholar | 是（SerpAPI，免费 250次/月） | 综合 |

**Unpaywall**：搜索后对有 DOI 但无 PDF 的论文自动查找开放获取 PDF（无需 Key）。

**Google Scholar 双保险**：scholarly + 服务器代理优先，失败自动回退 SerpAPI。服务器代理通过 `PROXY_URL` 或 `HTTP_PROXY`/`http_proxy` 环境变量读取。

### 核心流程（两阶段）

1. 用户发消息 → `POST /api/parse`：`classify_intent()` 判断意图 + `parse_query()` 提取关键词，返回普通 JSON
2. 前端展示可编辑关键词 Tag（左侧输入区），用户确认/增删后提交
3. `POST /api/search`（携带确认后的 keywords）→ 10 源并发搜索，每源最多 N 篇
4. 去重（DOI精确 + 标题规范化双重判断，重复时合并最优字段）→ Unpaywall 补全 PDF
5. `validate_papers()` 并行分批（每批 20 篇）LLM 过滤相关性
6. SSE 流式返回进度和结果，前端展示（分页 20 篇/页）
7. 右侧结果区持续显示关键词，用户可随时调整关键词或参数，一键重新搜索

---

## 关键文件

```
backend/
├── config.py              # Key + PROXY_URL + POLITE_EMAIL 等配置，从环境变量读取
├── models.py              # Paper（含 source_links）, ParseRequest, SearchRequest, ParsedQuery
├── .env.example           # Key 配置模板
├── services/
│   ├── llm_service.py     # classify_intent, parse_query, validate_papers（并行分批）
│   ├── search_service.py  # 10 源 + Unpaywall + 智能去重合并（_normalize_title/_merge/deduplicate）
│   └── download_service.py# PDF 代理下载，域名白名单
└── routers/search.py      # POST /api/parse, SSE /api/search, /api/download

frontend/src/
├── hooks/
│   ├── useSearch.ts       # 两阶段搜索（pendingKeywords, confirmedKeywords, confirmSearch, reSearch）
│   ├── useApiKey.ts       # localStorage Key 管理
│   └── useSettings.ts     # 搜索参数（每源最多200篇/展示上限500篇），持久化 localStorage
├── api/client.ts          # parseQuery(), searchPapers()（支持 confirmed keywords）, getDownloadUrl()
├── types/index.ts         # Paper（含 source_links）, Message, SearchEvent, ParseResult 类型
└── components/
    ├── KeySetupScreen.tsx  # 首次 Key 输入页
    ├── MainLayout.tsx      # 左右分栏容器，串联 confirmedKeywords/reSearch
    ├── ChatPanel.tsx       # 左侧对话区（含关键词确认编辑器）
    ├── ResultsPanel.tsx    # 右侧（关键词行、参数栏、排序、分页、批量下载、导出 CSV）
    ├── PaperCard.tsx       # 单篇论文卡片（多来源链接、checkbox 批量选择）
    └── MessageBubble.tsx   # 对话气泡

deploy/
├── setup.sh               # 首次部署
├── deploy.sh              # 后续更新（pull → uv sync → npm build → 重启）
├── nginx.conf             # server_name 目前是 IP
└── scholarscout-backend.service  # EnvironmentFile=-/etc/scholarscout/env
```

---

## API Key 管理

- **本地开发**：`backend/.env`（已加入 .gitignore），参考 `.env.example`
- **服务器**：`/etc/scholarscout/env`，chmod 600，systemd EnvironmentFile 读取
- **当前服务器已配置**：NASA_ADS_API_KEY、SERPAPI_KEY、PROXY_URL（http://127.0.0.1:7890）
- **待配置**：CORE_API_KEY（注册中）、SEMANTIC_SCHOLAR_API_KEY（申请中）

---

## 功能清单

### 已完成
- [x] 自然语言搜索（DeepSeek 意图识别 + 关键词提取）
- [x] 关键词可视化确认与编辑（两阶段流程，左侧 Tag 编辑器）
- [x] 结果页关键词持久显示，支持增删及重新搜索
- [x] 多源并发搜索（10 源，自实现）
- [x] Unpaywall 自动补全 PDF 链接
- [x] 智能去重合并（DOI + 标题规范化，重复时合并最优字段）
- [x] 多来源链接展示（同一论文被多个源命中，卡片显示所有来源按钮）
- [x] AI 相关性过滤（并行分批验证，20 篇/批）
- [x] 对话上下文（最近 8 条历史携带给 LLM）
- [x] 排序功能（相关性 / 引用数 / 最新 / 最早）
- [x] 分页展示（20 篇/页）+ 导出 CSV
- [x] 批量选择下载 PDF（ZIP 打包，失败明细写入 failed_downloads.csv）
- [x] 前端动态配置搜索参数（每源最多 200 篇 / 展示上限 500 篇）
- [x] 部署脚本（setup.sh 首次 + deploy.sh 更新）
- [x] .gitignore 清理（移除 __pycache__，补全 .DS_Store）

### 待做（详见 docs/backlog.md）
- [ ] Issue E：Semantic Scholar API Key（申请中）
- [ ] Issue F：CI/CD（GitHub Actions 自动跑测试）
- [ ] Issue G：结构化日志（替换 print）
- [ ] Issue H：健康检查接口 GET /api/health
- [ ] Issue I：Docker 支持
- [ ] 期刊/会议标注（venue 字段，从 S2/CrossRef/OpenAlex 提取）
- [ ] AI 筛选前后分开展示（已过滤论文可折叠查看，防止误判）

---

## 开发约定

- 后端用 `uv`（`uv add` 装包，`uv sync --no-dev` 生产部署）
- 服务器更新：`bash deploy/deploy.sh`（自动 pull + uv sync + npm build + 重启）
- 前端改动后跑 `npm run build` 确认 TypeScript 无错误
- API Key 不写入代码，通过环境变量或 .env 文件配置
- Google Scholar：scholarly + 代理优先，SerpAPI 兜底，不在 README 中公开说明
