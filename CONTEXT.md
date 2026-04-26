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
CI   GitHub Actions（backend pytest + frontend tsc build）
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

**Google Scholar 双保险**：scholarly + 服务器代理优先，失败自动回退 SerpAPI。

### 核心流程（两阶段）

1. 用户发消息 → `POST /api/parse`：`classify_intent()` 判断意图 + `parse_query()` 提取关键词
2. 前端展示可编辑关键词 Tag（左侧），用户确认/增删后提交
3. `POST /api/search`（携带确认后的 keywords）→ 10 源并发搜索
4. 去重 → Unpaywall 补全 PDF → `validate_papers()` 并行分批 LLM 过滤
5. SSE 流式返回 `{ papers, rejected_papers, message }`
6. 前端 Tab 切换"AI 筛选后 / 全部结果"展示，支持排序、分页、批量下载

---

## 关键文件

```
backend/
├── config.py              # Key + PROXY_URL + POLITE_EMAIL 等配置
├── models.py              # Paper（含 source_links, venue）, ParseRequest, SearchRequest
├── main.py                # FastAPI 入口，配置结构化日志
├── .env.example           # Key 配置模板
├── services/
│   ├── llm_service.py     # classify_intent, parse_query, validate_papers → (accepted, rejected)
│   ├── search_service.py  # 10 源 + Unpaywall + 智能去重（venue 从各源提取）
│   └── download_service.py
├── routers/search.py      # POST /api/parse, SSE /api/search, GET /api/health, /api/download
└── tests/                 # 21 个单元测试（dedup, merge, normalize, validate, parse）

frontend/src/
├── hooks/
│   ├── useSearch.ts       # 两阶段搜索 + rejectedPapers + searchFromHistory
│   ├── useSearchHistory.ts# localStorage 搜索历史（最近 10 条，去重）
│   ├── useApiKey.ts
│   └── useSettings.ts
├── api/client.ts
├── types/index.ts         # Paper（venue, source_links）, SearchDoneEvent（rejected_papers）
└── components/
    ├── MainLayout.tsx
    ├── ChatPanel.tsx      # 对话 + 关键词确认 + 搜索历史（时钟图标，一键复用）
    ├── ResultsPanel.tsx   # Tab(筛选后/全部) + 参数折叠面板 + 排序 + 分页 + 批量下载
    └── PaperCard.tsx      # 左侧彩色竖条(按源) + 作者行右侧显示 venue + 来源圆角徽章

.github/workflows/ci.yml  # backend pytest + frontend tsc build

deploy/
├── setup.sh / deploy.sh
├── nginx.conf
└── scholarscout-backend.service
```

---

## 前端 UI 设计要点

- **论文卡片**：左侧 3px 竖条按来源着色（10 色），来源 badge 圆角彩色，作者行左侧截断 + 右侧 venue
- **Tab 栏**："AI 筛选后（N）/ 全部结果（N+M）"+ 右侧排序下拉 + 参数折叠按钮（显示当前值）
- **关键词行**：实心蓝色 pill tags + 右端"重新搜索"按钮（有变更时出现）
- **空状态**：书本 SVG + 描述 + 3 个示例查询
- **加载状态**：旋转圆环 + 实时进度文字
- **搜索历史**：时钟图标 + hover 显示 ✕ 删除

---

## API Key 管理

- **本地开发**：`backend/.env`（已加入 .gitignore）
- **服务器**：`/etc/scholarscout/env`，systemd EnvironmentFile 读取
- **当前服务器已配置**：NASA_ADS_API_KEY、SERPAPI_KEY、PROXY_URL（http://127.0.0.1:7890）
- **待配置**：CORE_API_KEY（注册中）

---

## 待做

- Issue I：Docker 支持（暂缓，有需求再做）
- README 截图更新（需手动截图后放入 `docs/screenshots/`）

---

## 开发约定

- 后端用 `uv`（`uv add` 装包，`uv sync --no-dev` 生产部署）
- 服务器更新：`bash deploy/deploy.sh`
- 前端改动后跑 `npm run build` 确认 TypeScript 无错误
- API Key 不写入代码
