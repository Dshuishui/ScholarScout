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
     Kimi API（服务器 Key，用于 PDF 深度查找联网搜索）
搜索 10 个数据源并发 + Unpaywall + Kimi PDF 深度查找
部署 Nginx + systemd，ubuntu 用户
CI   GitHub Actions（backend pytest + frontend tsc build）
截图 scripts/screenshot.mjs（Playwright，npm install 后可运行）
```

### 搜索源（10 个，前端可多选）

| 源 | 需要 Key | 领域 |
|---|---|---|
| arXiv | 否 | CS / 物理 / 数学 |
| Semantic Scholar | 否 | 综合 |
| OpenAlex | 否 | 综合，2 亿+ |
| PubMed | 否 | 医学 / 生物 |
| Europe PMC | 否 | 生命科学 + bioRxiv/medRxiv |
| INSPIRE-HEP | 否 | 高能物理 |
| CrossRef | 否 | 综合，1.5 亿+ |
| CORE | 是（免费） | 1.7 亿+ 开放获取 |
| NASA ADS | 是（免费） | 天文 / 天体物理 |
| Google Scholar | 是（SerpAPI） | 综合 |

### 核心流程

1. 用户发消息 → `POST /api/parse`：意图识别 + 关键词提取
2. 前端展示可编辑关键词 Tag，用户确认后提交
3. `POST /api/search`（含 keywords、sources、limits）→ 选中源并发搜索
4. 去重 → Unpaywall 补全 → `validate_papers()` → SSE 推送 `done`（含 rejected_papers）
5. 前端立刻展示结果，释放输入框
6. 后台继续：Kimi 联网批量查找无 PDF 论文 → SSE 推送 `pdf_finding` + `pdf_update`
7. 前端静默更新卡片 PDF 链接或展示 8 个平台备用查找入口

---

## 关键文件

```
backend/
├── config.py              # DEEPSEEK/KIMI/NASA/SERPAPI/CORE Key + PROXY_URL
├── models.py              # Paper（venue, source_links, fallback_links）, SearchRequest（sources）
├── main.py                # FastAPI + 结构化日志
├── services/
│   ├── llm_service.py     # classify_intent, parse_query, validate_papers → (accepted, rejected)
│   ├── search_service.py  # _SOURCE_FUNCS dict + search_all_sources(sources=None 过滤)
│   ├── pdf_finder_service.py  # find_pdfs_with_kimi（多轮工具调用）+ generate_fallback_links（8平台）
│   └── download_service.py
├── routers/search.py      # /api/parse /api/search /api/health /api/download
│                          # search 流：done → pdf_finding → pdf_update
└── tests/                 # 21 个单元测试

frontend/src/
├── hooks/
│   ├── useSearch.ts       # 两阶段搜索 + rejectedPapers + pdf事件处理（done后释放isLoading）
│   ├── useSearchHistory.ts# localStorage 搜索历史（最近10条，去重）
│   ├── useApiKey.ts       # Key: 'scholarscout_deepseek_key'
│   └── useSettings.ts     # SearchSettings{limitPerSource,validatedLimit,selectedSources}
│                          # ALL_SOURCES 常量导出，默认全选，localStorage持久化
├── api/client.ts          # searchPapers 传 sources 字段
├── types/index.ts         # Paper{venue,source_links,fallback_links}
│                          # SearchPdfFindingEvent / SearchPdfUpdateEvent
└── components/
    ├── MainLayout.tsx
    ├── ChatPanel.tsx      # 对话 + 关键词确认 + 搜索历史（时钟图标）
    ├── ResultsPanel.tsx   # 顶部始终展开配置区（源多选+数字输入）
    │                      # Tab(AI筛选后/全部) + 排序 + 关键词行 + 论文列表
    └── PaperCard.tsx      # 左侧彩色竖条 + 作者行右侧venue + hover复制按钮
                           # fallback_links展示（无PDF时显示8个平台跳转）

scripts/
└── screenshot.mjs         # Playwright 截图：npm install + npx playwright install chromium

docs/images/               # 5张截图（01~05）已提交
.github/workflows/ci.yml   # backend pytest + frontend tsc build
```

---

## 前端 UI 设计要点

- **论文卡片**：左侧 3px 竖条按来源着色（10 色），来源 badge 圆角彩色，作者行左侧截断 + 右侧 venue，hover 时标题右侧出现复制图标（对勾 2s 反馈）
- **无 PDF 论文**：先显示结果，后台 Kimi 联网查找，找到更新 PDF 按钮；找不到展示 8 个平台跳转链接（arXiv预印本/Sci-Hub/ResearchGate/S2/Google Scholar/CORE/BASE/Open Access Button）
- **配置区**：始终展开，顶部第一块，源多选框带颜色、全选/清空，数字输入框（blur自动clamp）
- **Tab 栏**：AI筛选后 / 全部结果（含AI过滤标记），右侧排序下拉
- **关键词行**：实心蓝色 pill + hover ✕ 删除，关键词变化时右端出现重搜按钮
- **空状态**：书本 SVG + 示例查询卡片
- **加载状态**：旋转圆环 + 实时进度文字（done后立即释放输入框，PDF查找在后台）
- **搜索历史**：时钟图标 + hover显示 ✕，一键复用跳过解析

---

## API Key 管理

- **本地开发**：`backend/.env`（gitignore）
- **服务器**：`/etc/scholarscout/env`，systemd EnvironmentFile 读取
- **当前服务器已配置**：NASA_ADS_API_KEY、SERPAPI_KEY、PROXY_URL（http://127.0.0.1:7890）
- **待配置**：KIMI_API_KEY（需加到服务器 env 才能启用 PDF 深度查找）、CORE_API_KEY（注册中）

---

## 待做

- **Feature 4：每篇论文独立对话抽屉**（已讨论方案，未实现）
  - 点击论文卡片右侧图标，右侧滑出抽屉式小窗
  - 内置独立 DeepSeek 对话，系统 prompt 自动注入论文标题+摘要+venue
  - 每篇论文独立上下文，不污染主对话
  - 用用户自己的 DeepSeek Key 直接调用，不经过服务器
- **KIMI_API_KEY 配置到服务器**：`/etc/scholarscout/env` 加 `KIMI_API_KEY=xxx`，重启服务
- **Issue I：Docker 支持**（暂缓）
- **部署最新代码**：`bash deploy/deploy.sh`

---

## 开发约定

- 后端用 `uv`（`uv add` 装包，`uv sync --no-dev` 生产部署）
- 服务器更新：`bash deploy/deploy.sh`（pull + uv sync + npm build + 重启）
- 前端改动后跑 `npm run build` 确认 TypeScript 无错误
- API Key 不写入代码
- 截图：`cd frontend && npm run build && npx vite preview --port 4173`，另一终端 `node scripts/screenshot.mjs`
