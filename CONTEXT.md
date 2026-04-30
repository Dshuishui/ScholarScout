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
统计 Umami（Docker Compose，本地 3001 端口，nginx 代理 /analytics/）
CI   GitHub Actions（backend pytest + frontend tsc build）
```

---

## 关键文件

```
backend/
├── config.py              # DEEPSEEK/KIMI/NASA/SERPAPI/CORE Key + PROXY_URL
├── models.py              # Paper, SearchRequest, ParseRequest, ValidateKeyRequest（含字段长度限制）
├── main.py                # FastAPI + 结构化日志
├── services/
│   ├── llm_service.py     # classify_intent, parse_query（无日期时默认近5年）, validate_papers
│   ├── search_service.py  # _SOURCE_FUNCS dict + search_all_sources(on_source_done 回调) + get_source_names
│   ├── pdf_finder_service.py  # find_pdfs_with_kimi + generate_fallback_links（8平台）
│   └── download_service.py    # fetch_pdf_bytes（流式读取，50MB 限制，域名白名单 SSRF 防护）
├── routers/search.py      # /api/parse /api/search /api/validate-key /api/health /api/download
└── tests/                 # 21 个单元测试（pytest）

frontend/src/
├── hooks/
│   ├── useSearch.ts       # 两阶段搜索 + sourceStatuses（per-source进度）+ rejectedPapers + pdf事件
│   ├── useSearchHistory.ts# localStorage 搜索历史（最近10条）
│   ├── useApiKey.ts       # Key: 'scholarscout_deepseek_key'
│   ├── useSettings.ts     # SearchSettings + ALL_SOURCES + localStorage持久化
│   └── usePaperChat.ts    # 每篇论文独立对话历史 + DeepSeek 直接调用（流式）
├── api/client.ts
├── types/index.ts         # SearchEvent 含 SearchStartEvent + SourceDoneEvent
└── components/
    ├── MainLayout.tsx     # 键盘快捷键(/ Esc) + 动态Tab标题 + sourceStatuses传递
    ├── ChatPanel.tsx      # 对话 + 关键词确认 + 搜索历史 + inputRef
    ├── ResultsPanel.tsx   # 来源进度网格 + 骨架屏 + 卡片动画 + 搜索统计 + 密度切换 + 分组视图
    ├── PaperCard.tsx      # 微交互(hover上浮/按钮scale) + 质量徽章(高引/OA) + 相关性预览
    ├── PaperCardSkeleton.tsx
    ├── PaperChatDrawer.tsx    # 右侧论文对话抽屉（可配置快捷提问）
    ├── KeySetupScreen.tsx     # 封面 + Key验证 + 历史Key记录（localStorage）
    ├── MessageBubble.tsx
    └── Toast.tsx

deploy/
├── deploy.sh              # 更新部署（含同步 nginx.conf）
├── setup.sh               # 首次部署
├── setup_umami.sh         # Umami 统计一键部署（Docker + nginx）
├── umami-compose.yml      # Umami + PostgreSQL Docker Compose
├── nginx.conf             # 含限速 + 安全头 + /analytics/ 代理
├── scholarscout-backend.service
└── .umami.env             # 已 gitignore，含 DB_PASSWORD + APP_SECRET

frontend/public/
├── favicon.svg
├── icons.svg
└── preview.png            # 封面 App 预览窗口截图（来自 docs/images/03_ai_chat_drawer.png）
```

---

## API 接口

| 接口 | 说明 |
|------|------|
| `POST /api/parse` | 意图识别 + 关键词提取 |
| `POST /api/search` | SSE 流式搜索（含 search_start / source_done / done / pdf_update） |
| `POST /api/validate-key` | 验证 DeepSeek Key（发一条 max_tokens=1 的 chat completion，只看 HTTP 状态码） |
| `GET /api/download?url=` | PDF 代理下载（域名白名单 + 50MB 限制） |
| `GET /api/health` | 健康检查 |

---

## 安全措施（本 session 新增）

### Nginx 限速（deploy/nginx.conf）
```
/api/search:   5次/分钟，burst=3（LLM + 10源并发，最昂贵）
/api/download: 120次/分钟，burst=50（支持批量下载场景）
/api/其他:     30次/分钟，burst=15
```

### 安全响应头
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

### 后端防护
- **SSRF**：`download_service.py` 域名白名单（10个学术域名）
- **文件大小**：下载接口流式读取，超 50MB 中断
- **请求体限制**：Pydantic Field 约束（query≤2000字符，messages≤30条，每条≤5000字符）
- **错误信息**：Exception 只记日志，用户只看通用错误提示

---

## 前端 UI 新增功能（本 session）

### PaperCard（论文卡片）
- hover 上浮 0.5px + shadow-lg（微交互 P4）
- 所有操作按钮 `active:scale-95` 按压效果
- 来源 badge hover 显示数据库简介 tooltip（`SOURCE_DESCRIPTIONS` map）
- **质量徽章**：`citations ≥ 1000` → 琥珀色"高引"；有 pdf_url → 绿色"OA"
- **紧凑模式相关性预览**：compact 且未展开时始终显示 1 行 `✦ relevance_reason`
- 标题 `font-semibold` → `font-bold`

### ResultsPanel（搜索结果面板）
- **来源进度网格**：搜索中显示所有选中数据源 spinner/✓ + 完成篇数
- 需要 `sourceStatuses` prop（来自 `useSearch` → `MainLayout` → `ResultsPanel`）

### KeySetupScreen（封面）
- **历史 Key 记录**：localStorage key `scholarscout_saved_keys`，最多 5 条
  - 显示 `sk-···xxxx`（最后4位），点"使用"直接进入不重复验证
  - ✕ 可删除单条，成功验证新 Key 自动保存
- **App 预览窗口**：真实截图 `/preview.png`（macOS 窗口框内）
- **特性卡片**：2×2 等宽网格（不是 bento）

### 搜索进度可视化（P2 Perplexity 风格）
后端 `search_all_sources` 通过 `on_source_done` 回调 + asyncio.Queue 实时推送 SSE：
- `search_start`：{sources: [...]} 通知前端哪些源将被搜索
- `source_done`：{source, count} 每个源完成时推送

---

## Umami 统计系统

- **访问地址**：管理后台通过 SSH 隧道 `ssh -L 3001:localhost:3001 ubuntu@118.25.192.117`，访问 `http://localhost:3001`
- **tracking script**：`/analytics/script.js`（nginx 代理 → localhost:3001）
- **Website ID**：`ff24afb1-395c-40f5-b7a7-86fc6721b16b`（已写入 frontend/index.html）
- **Docker 容器**：`deploy-umami-1`（ghcr.io/umami-software/umami）+ `deploy-db-1`（postgres:15-alpine）
- **操作**：`sudo docker compose -f deploy/umami-compose.yml --env-file deploy/.umami.env ps/up/down`
- **nginx 配置**：`location /analytics/ { proxy_pass http://127.0.0.1:3001/; }` （注意两端都有尾部斜杠）
- **注意**：Umami v2 Docker 镜像不支持 `BASE_PATH` 环境变量，必须用 nginx strip 前缀方式

---

## 重要设计决策

- **未指定日期 → 默认近5年**：`parse_query` 里 date_from 为 null 时自动填 `(today.year-5)-01-01`
- **中文论文支持有限**：10个源均以英文为主，知网/万方等需机构授权未接入
- **Key 验证方式**：用 httpx 直接 POST `/v1/chat/completions`（max_tokens=1），只看 HTTP 状态码。不用 `models.list()`（DeepSeek 返回格式与 openai SDK 预期不同，会触发解析异常）。不用 openai 客户端（可能受 proxy 变量影响）
- **服务器代理**：`/etc/scholarscout/env` 里有 `PROXY_URL=http://127.0.0.1:7890`（scholarly 用），这是自定义变量，httpx/openai 客户端**不会**自动使用。Docker daemon 有单独的 proxy 配置（`/etc/systemd/system/docker.service.d/proxy.conf`）用于拉取镜像
- **deploy.sh 同步 nginx.conf**：每次部署都会 `sudo cp deploy/nginx.conf /etc/nginx/sites-available/scholarscout`，以前只有 setup.sh 会做这步
- **批量下载**：前端 `DOWNLOAD_CONCURRENCY=3`，nginx 给 `/api/download` 单独 120r/m 区间，不影响批量下载
- **测试 mock 方式**：`patch.dict("services.search_service._SOURCE_FUNCS", ...)` 替换整个 dict
- **密度设置**：localStorage key `scholarscout_density`，默认 'compact'

---

## localStorage Keys 汇总

| Key | 用途 |
|-----|------|
| `scholarscout_deepseek_key` | 当前使用的 DeepSeek API Key |
| `scholarscout_saved_keys` | 历史 Key 列表（JSON，最多5条，含完整key+时间戳）|
| `scholarscout_density` | 卡片密度（'compact' \| 'standard'）|
| `scholarscout_quick_prompts` | 论文对话抽屉快捷提问列表 |
| `scholarscout_search_history` | 搜索历史（最近10条关键词组） |

---

## 服务器维护命令

```bash
# 查看后端日志
sudo journalctl -u scholarscout-backend -n 50 --no-pager

# 查看 Umami 状态
sudo docker compose -f deploy/umami-compose.yml --env-file deploy/.umami.env ps

# Umami 日志
sudo docker compose -f deploy/umami-compose.yml --env-file deploy/.umami.env logs umami

# 重启 Umami
sudo docker compose -f deploy/umami-compose.yml --env-file deploy/.umami.env restart

# 重新部署完整项目
bash deploy/deploy.sh
```

---

## 待做

- **多模型支持**（已在 README 预告）：对话框支持 Claude / GPT / Gemini，目前只有 DeepSeek
- **收藏/书签功能**：localStorage 持久化，设计复杂暂缓
- **Docker 支持（主应用）**：暂缓
- **封面截图更新**：新封面需要重新截图放到 README
- **Key 验证**：目前正在排查，httpx 直接 POST chat completion 应该是最可靠方案，如还有问题看服务器日志
