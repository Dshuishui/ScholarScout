# ScholarScout 开发上下文

> 给下一个 Claude 实例读的。读完可以无缝接手。

---

## 项目概述

面向非技术用户的学术论文搜索工具。用户输入 DeepSeek API Key，用中文自然语言描述需求，系统搜索真实论文并返回可预览/下载的结果。

- **线上地址**：http://118.25.192.117（个人云服务器，开放约至 2027 年初）
- **服务器**：118.25.192.117，ubuntu 用户，4C4G，仓库在 `/home/ubuntu/Github/ScholarScout`
- **GitHub**：https://github.com/Dshuishui/ScholarScout
- **部署**：`bash deploy/deploy.sh`（用户每次都会自己在服务器上执行）

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

1. 用户发消息 → `POST /api/parse`：意图识别 + 关键词提取（**未指定日期时默认近5年**）
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
│   ├── llm_service.py     # classify_intent, parse_query（无日期时默认近5年）, validate_papers
│   ├── search_service.py  # _SOURCE_FUNCS dict + search_all_sources(sources=None 过滤)
│   ├── pdf_finder_service.py  # find_pdfs_with_kimi + generate_fallback_links（8平台）
│   └── download_service.py
├── routers/search.py      # /api/parse /api/search /api/health /api/download
└── tests/                 # 21 个单元测试（pytest）

frontend/src/
├── hooks/
│   ├── useSearch.ts       # 两阶段搜索 + rejectedPapers + pdf事件处理
│   ├── useSearchHistory.ts# localStorage 搜索历史（最近10条）
│   ├── useApiKey.ts       # Key: 'scholarscout_deepseek_key'
│   ├── useSettings.ts     # SearchSettings + ALL_SOURCES + localStorage持久化
│   └── usePaperChat.ts    # 每篇论文独立对话历史 + DeepSeek 直接调用（流式）
├── api/client.ts
├── types/index.ts
└── components/
    ├── MainLayout.tsx     # 键盘快捷键(/ Esc) + 动态Tab标题 + 抽屉状态管理
    ├── ChatPanel.tsx      # 对话 + 关键词确认 + 搜索历史 + inputRef
    ├── ResultsPanel.tsx   # 骨架屏 + 卡片动画 + 搜索统计 + 密度切换 + 分组视图
    ├── PaperCard.tsx      # 紧凑/标准模式 + 展开摘要 + Google Scholar + AI对话按钮
    ├── PaperCardSkeleton.tsx  # shimmer 骨架屏卡片
    ├── PaperChatDrawer.tsx    # 右侧论文对话抽屉（可配置快捷提问）
    ├── KeySetupScreen.tsx     # 封面：左右分栏，辉光球动效，打字机，App预览，特性卡片
    ├── MessageBubble.tsx
    └── Toast.tsx          # 全局 toast 通知（toast.show(msg)）
```

---

## 前端 UI 设计要点

### PaperCard（论文卡片）
- 左侧 3px 竖条按来源着色（10色，arXiv=绿色）
- 标题行：title (text-base font-semibold) + 复制按钮（常驻，成功有 toast 提示）
- 作者行右侧显示 venue（max-w-[45%] truncate）
- meta 行：年份 · 来源 badge · 引用数
- **紧凑模式**（默认）：摘要折叠，全宽横条"查看摘要与 AI 分析 ▾"可展开，显示前60字预览
- **标准模式**：始终显示摘要
- 密度切换（紧凑/标准）持久化到 localStorage
- Actions 行末尾：**Google Scholar 按钮**（sky蓝色，"引用·全文·相关"副标题）+ **AI 对话按钮**（violet，"独立上下文"副标题）

### ResultsPanel
- 顶部始终展开配置区：10源多选（arXiv=绿色）+ 每源抓取/展示上限数字输入
- Tab 栏：AI筛选后 / 全部结果 + 计数
- Tab 栏右侧：**密度切换**（紧凑/标准）+ **视图切换**（列表/分组）+ 排序下拉
- **分组视图**：每组有可折叠 header（来源名+篇数+chevron），点击折叠
- **搜索统计行**："共找到 X 篇 · AI 筛选保留 Y 篇 · 过滤 Z 篇低相关"
- **骨架屏**：搜索中显示 6 张 shimmer 卡片，不再是大圆圈 spinner
- **卡片动画**：results 出现时各卡片 55ms 错落 fadeUp
- **空状态**：示例查询可点击，直接触发搜索

### KeySetupScreen（封面）
- 左侧 62%：深色 navy 渐变流动 + 三色辉光球（蓝/紫/青，各自脉冲动画）
- 打字机标题 text-7xl font-black，第二行渐变文字
- macOS 风格 App 预览窗口（仿真论文卡片 + Scholar/AI对话按钮）
- 底部 4 个特性卡片（2x2 grid，text-sm white + 图标）
- 右侧 38%：浅灰 #f8fafc + 左上辉光
  - 3 张白色 benefit 卡片（填充空白）
  - 分隔线 + 渐变标题 + 数据徽章 + 输入框（发光聚焦） + 按钮（hover上浮）

### 其他
- **Toast**：`toast.show(msg)` 全局，底部居中，黑色圆角条，2.8s 自动消失
- **Favicon**：蓝色圆角方块书本图标（inline SVG data URI）
- **动态 Tab 标题**：搜索后变 `keyword1 · keyword2 — ScholarScout`
- **键盘快捷键**：`/` 聚焦搜索框，`Esc` 关闭论文对话抽屉

---

## API Key 管理

- **本地开发**：`backend/.env`（gitignore）
- **服务器**：`/etc/scholarscout/env`，systemd EnvironmentFile 读取
- **当前服务器已配置**：NASA_ADS_API_KEY、SERPAPI_KEY、PROXY_URL、KIMI_API_KEY
- DeepSeek Key：用户自带，存 localStorage（`scholarscout_deepseek_key`）

---

## 重要设计决策

- **未指定日期 → 默认近5年**：`parse_query` 里 date_from 为 null 时自动填 `(today.year-5)-01-01`
- **中文论文支持有限**：10个源均以英文为主，知网/万方等需机构授权未接入
- **Google Scholar 按钮**：每张卡片常驻，优先复用 source_links 里的 Scholar URL，否则拼 `scholar.google.com/scholar?q="title"` 精确搜索
- **测试 mock 方式**：用 `patch.dict("services.search_service._SOURCE_FUNCS", ...)` 替换整个 dict，不 patch 单个函数名（因为 dict 存的是函数对象引用）
- **PaperChatDrawer 快捷提问**：localStorage key `scholarscout_quick_prompts`，可增删，恢复默认
- **密度设置**：localStorage key `scholarscout_density`，默认 'compact'

---

## 待做

- **多模型支持**（已在 README 预告）：对话框未来支持 Claude / GPT / Gemini 等，目前只有 DeepSeek
- **收藏/书签功能**：localStorage 持久化，设计复杂暂缓
- **Docker 支持**：暂缓
- **封面截图更新**：新封面需要重新截图放到 README
