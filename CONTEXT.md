# ScholarScout 开发上下文

> 给下一个 Claude 实例读的。读完可以无缝接手。

---

## 项目概述

面向研究者的 AI 学术论文搜索工具。用户输入 DeepSeek API Key，用中文自然语言描述需求，系统搜索真实论文并返回可预览/下载的结果。支持论文独立 AI 对话、PDF 全文分析、收藏、CSV 导出、留言板等功能。

- **线上地址**：http://118.25.192.117（个人云服务器）
- **服务器**：118.25.192.117，ubuntu 用户，4C4G，仓库在 `/home/ubuntu/Github/ScholarScout`
- **GitHub**：https://github.com/Dshuishui/ScholarScout（用户：Dshuishui）
- **部署**：`bash deploy/deploy.sh`（git pull → uv sync → npm build → rsync → systemctl restart）
- **作者邮箱**：dongyucong@sjtu.edu.cn（留言板作者账号：dshuishui168@gmail.com）

---

## 技术架构

```
前端   React + Vite + TypeScript + Tailwind CSS
后端   Python 3.11 + FastAPI + SQLAlchemy async + SQLite (aiosqlite)
LLM    DeepSeek API（搜索/解析固定用 deepseek-v4-flash，论文对话用用户选择模型）
AI Key 用户自带，前端 localStorage 存储，直接从浏览器调 DeepSeek API
部署   Nginx + systemd，ubuntu 用户
统计   Umami (Docker Compose，本地 3001，nginx 代理 /analytics/)
CI     GitHub Actions (backend pytest + frontend tsc -b && vite build)
```

---

## 已完成功能（截至当前 commit: 9c4799e）

### 核心功能
- [x] 自然语言 → AI 提取关键词 → 并发搜索 10 源 → AI 筛选 → 展示结果
- [x] 来源进度实时可视化（per-source spinner/✓ + 篇数，SSE 推送）
- [x] 论文独立 AI 对话（支持手动上传 PDF 全文分析；pdfTexts 用 useRef 避免闭包过期 bug）
- [x] 对话记录持久化：再次打开同篇论文自动恢复历史，支持新建会话
- [x] 账号系统（JWT 注册/登录，React Context useAuth 全局状态）
- [x] 收藏论文（即时 localStorage 缓存，乐观更新无延迟）
- [x] CSV 导出（AI 相关性分析列 + AI 批量翻译中文标题 + 论文对话 HTML，可打包 ZIP）
- [x] 批量 PDF 下载（ZIP + 失败 README.txt 含作者邮箱及留言板入口）
- [x] 留言板（公开，支持引用回复、登录用户5分钟内可撤回、频率限制）
- [x] 红色小熊猫 mascot（随机气泡 8 条，搜索超 8s 触发，点击互动）

### 前端设计主题（当前状态）
- **顶栏**：深色 `#080818` + indigo 网格纹理 + 左右辉光，直接延续落地页氛围
- **内容区背景**：`radial-gradient(indigo hint) + #f7f8fc` 微色调
- **主题色**：indigo（全局统一，替代旧的 blue——搜索按钮、tab 选中、density 切换等）
- **排版层级**：section label 风格（`text-[11px] font-semibold uppercase tracking-widest` + 竖条）
- **ChatPanel**：移除冗余品牌头（顶栏已有），替换为"搜索对话"section label
- **搜索输入框**：统一圆角容器风格（和论文对话框一致），带工具栏
- **搜索配置区**：毛玻璃 `bg-white/70 backdrop-blur-sm`，indigo 勾选框
- **模型选择器**：卡片式 2 列（替代下拉框），显示模型名 + 功能说明
- **收藏按钮**：两行 pill（主文字 + 副标题），与 AI 对话、Google Scholar 按钮等高

---

## 关键文件结构

```
frontend/src/
  components/
    MainLayout.tsx        — 主布局（深色顶栏，无 onClearKey 传给 ChatPanel）
    ChatPanel.tsx         — 左侧面板（Props: 无 onClearKey，已删除）
    ResultsPanel.tsx      — 右侧结果（indigo 主题，毛玻璃配置区，导出进度状态）
    PaperCard.tsx         — 论文卡片（两行收藏按钮）
    PaperChatDrawer.tsx   — 论文 AI 对话抽屉（PDF 上传，无自动 fetch）
    KeySetupScreen.tsx    — 落地页（卡片式模型选择器）
    FeedbackWidget.tsx    — 留言板（560px，乐观更新，回复/撤回）
    RedPandaWidget.tsx    — 小熊猫
    UserMenu.tsx          — 用户菜单（登录按钮适配深色顶栏 indigo 样式）
  hooks/
    usePaperChat.ts       — pdfTexts 用 useRef（非 useState），避免闭包过期
    useSearch.ts          — SSE 两阶段搜索，sourceStatuses per-source 进度
    useAuth.ts            — React Context，AuthProvider 包裹 App
    useSearchHistory.ts   — 最多 3 条，已去重

backend/
  routers/
    search.py    — /parse /search /validate-key /download（浏览器UA，60s超时）
    user.py      — 收藏/历史/对话记录（POST /saved 返回 paper_id_hash）
    feedback.py  — 留言板（GET 支持可选 JWT 返回 can_recall，DELETE 撤回）
    paper.py     — PDF 解析（/fetch-pdf 自动获取，/parse-pdf 手动上传）
    auth.py      — 注册/登录
  models_db.py   — Feedback: user_id/reply_to_id/recalled 字段
  database.py    — init_db() 含 ALTER TABLE 迁移（try/except 模式）
  services/
    download_service.py — 浏览器 UA，60s 超时，HTML 响应检测（arxiv 反爬）
    llm_service.py      — _json_model() helper（R1 降级），validate_papers 全失败兜底
```

---

## localStorage Keys 汇总

| Key | 用途 |
|-----|------|
| `scholarscout_deepseek_key` | 当前 DeepSeek Key |
| `scholarscout_saved_keys` | 历史 Key 列表（JSON，最多5条）|
| `scholarscout_model` | 选择的论文对话模型 |
| `scholarscout_density` | 卡片密度（compact/standard）|
| `scholarscout_quick_prompts` | 论文对话快捷提问 |
| `scholarscout_search_history` | 搜索历史（最近3条）|
| `ss_saved_map` | 收藏状态缓存（`[[paper_id, hash], ...]`），登出时清除 |

---

## API 接口

| 接口 | 说明 |
|------|------|
| `POST /api/parse` | 意图识别 + 关键词提取 |
| `POST /api/search` | SSE 流式搜索（search_start/source_done/papers/done 等事件） |
| `POST /api/validate-key` | 验证 DeepSeek Key |
| `GET /api/download?url=` | PDF 代理下载（域名白名单 + 50MB 限制） |
| `GET/POST /api/feedback` | 留言板读/写（可选 JWT） |
| `DELETE /api/feedback/{id}` | 撤回留言（需 JWT，5分钟内，本人） |
| `POST /api/paper/fetch-pdf` | 自动从 URL 获取 PDF 文本 |
| `POST /api/paper/parse-pdf` | 解析上传的 PDF 文件 |
| `GET/POST /api/user/saved` | 收藏（POST 返回 paper_id_hash）|
| `GET/POST /api/user/chats` | AI 对话记录持久化 |

---

## 已知问题 / 技术债

1. **arxiv PDF 下载失败**：云服务器 IP 被反爬，即使改了 UA 仍可能失败。根本解决需要代理 IP，暂搁置。下载失败 ZIP 里已有 README.txt 提示用户。
2. **nginx 频率限制和前端不匹配**：留言板前端改为"2分钟5条"，nginx `deploy/nginx.conf` 里 `api_feedback` zone 还是 `2r/min`，需改为 `10r/min`。
3. **关键词确认摩擦**：用户输入 → AI 提取 → 弹出确认框 → 手动确认 → 搜索。多了一步，待优化。
4. **AI 筛选后 0 篇时无引导**：应提示"切到全部结果或调整搜索词"。
5. **搜索失败无恢复路径**：API 超时/报错只在对话框显示消息，无重试按钮。

---

## 后续计划（优先级排序）

### 近期（小改动）

1. **nginx 频率限制修复**（5分钟能改完）
   - 文件：`deploy/nginx.conf`，`api_feedback` zone 从 `2r/min` → `10r/min`

2. **AI 筛选后 0 篇引导**
   - `ResultsPanel.tsx`：筛选结果为 0 时显示引导卡片"可切到全部结果"

3. **搜索失败恢复**
   - `useSearch.ts` / `ChatPanel.tsx`：搜索失败时显示重试按钮

4. **关键词确认体验优化**
   - 改为：立即开始搜索 + 关键词作为顶部可编辑 chips（不阻塞流程）

### Phase 2：订阅 + 邮件推送

目标：用户订阅关键词/研究方向，每周自动搜索并邮件推送新论文。

技术方案（待设计）：
- 新增 Subscription 模型（user_id, keywords, frequency, last_sent）
- 定时任务：APScheduler 或系统 cron
- 邮件：SMTP（QQ 邮箱 / 阿里云），HTML 模板
- 前端：UserMenu 里"订阅管理"入口

### Phase 3：AI 对话升级

目标：跨论文对比、文献综述生成。

技术方案（待设计）：
- 多论文选中 → 统一 context 传 AI
- DeepSeek 64K context 窗口够用
- 需要 streaming 支持长文本输出

---

## Nginx 限速配置（deploy/nginx.conf）

```
/api/search:    5r/min，burst=3（最昂贵，LLM + 10源并发）
/api/download:  120r/min，burst=50（支持批量下载）
/api/feedback:  2r/min（待改为 10r/min！）
/api/其他:      30r/min，burst=15
```

## 服务器维护命令

```bash
sudo journalctl -u scholarscout-backend -n 50 --no-pager  # 后端日志
bash deploy/deploy.sh                                        # 重新部署
sudo docker compose -f deploy/umami-compose.yml --env-file deploy/.umami.env ps  # Umami 状态
```

## 重要设计决策（勿忘）

- **pdfTexts 用 useRef**：`usePaperChat.ts` 里 PDF 文本用 `useRef<Map>` 而非 useState，避免 sendMessage useCallback 闭包捕获过期值
- **`onClearKey` 已从 ChatPanel 删除**：顶栏已有换 Key 按钮，ChatPanel Props 不再有此字段，MainLayout 不再传此 prop（删了会 CI 报错 TS6133）
- **收藏乐观更新**：POST /saved 返回 `paper_id_hash`，前端直接更新 localStorage，不重新拉全量
- **留言板乐观更新**：POST 成功后立即 setItems 添加新消息，800ms 后 GET 刷新完整数据（含 location/is_author）
- **Key 验证方式**：httpx 直接 POST `/v1/chat/completions`（max_tokens=1），只看 HTTP 状态码
- **默认日期范围**：未指定日期时 `parse_query` 自动填近5年 `(today.year-5)-01-01`
