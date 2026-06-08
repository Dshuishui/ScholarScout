# ScholarScout 开发进度

> 压缩上下文后读这个文件快速入状态。最后更新：2026-06-08（Session 8）

---

## 项目概况

- **线上地址**：http://118.25.192.117
- **服务器**：ubuntu@118.25.192.117，仓库在 `/home/ubuntu/Github/ScholarScout`
- **部署**：`bash deploy/deploy.sh`（git pull → uv sync --frozen → npm build → rsync → systemctl restart）
- **GitHub**：https://github.com/Dshuishui/ScholarScout
- **最新 commit**：`3aa5be8` fix(download): add bioRxiv/medRxiv fallback; enforce port validation

---

## 技术栈

```
前端   React + Vite + TypeScript + Tailwind CSS
后端   Python 3.11 + FastAPI + SQLAlchemy async + SQLite
LLM    DeepSeek API（用户自带 Key 或系统 Key 试用）
定时   APScheduler（每天 00:00 UTC = 08:00 CST）
邮件   QQ SMTP（smtp.qq.com:465）
```

---

## 已完成功能（全部）

- 账号系统：邮件注册验证 / JWT / 自动登出
- 免费试用：3 次搜索（新用户验证后获得）
- 10 源并发搜索 + 智能去重 + AI 相关性过滤
- 搜索结果 AI 过滤 / 分组视图 / 排序 / 配置限制
- 关键词订阅 + 每日推送队列（08:00 CST）+ 进度可视化
- 多文献 AI 对比分析（对比 / 综述 / 趋势）
- 单篇论文 AI 对话（含 PDF 上传全文分析，云端持久化）
- 收藏 / 历史记录
- CSV 导出（AI 过滤版 / 全量）
- 批量 PDF 下载（ZIP 打包，失败时生成 手动下载链接.html + failed_downloads.csv）
- 单篇 PDF 按钮（直链，不走服务器代理）
- 移动端适配（底部 Tab + 底部抽屉）
- 代码分割（首屏 gzip ~126 KB）
- 留言板

---

## Session 8 完成的工作（2026-06-08）

### 1. 搜索数据质量修复
**文件**：`backend/services/search_service.py`、`frontend/src/components/PaperCard.tsx`
- 新增 `_clean_title()`：清洗 CrossRef 等来源返回的 JATS XML 标签（如 `<i>E. coli</i>`），导致论文名搜索不到
- 新增 `_clean_authors()`：过滤空字符串作者名，解决"作者不详"乱显示
- 新增 `_sanitize_paper()`：在 `search_all_sources()` 入口统一清洗，覆盖所有 10 个数据源
- 前端 `PaperCard.tsx`：加 `validAuthors.filter()` 防御性过滤
- **Commit**：`a0738d5`

### 2. 邮件 Date 头修复 + 注册域名拼写检测
**文件**：`backend/services/email_service.py`、`frontend/src/components/AuthModal.tsx`
- 两个 MIMEMultipart 都加了 `msg["Date"] = formatdate(localtime=True)`，修复邮件时间显示 1970-01-01
- 注册表单加常见域名拼写检测（如 `@qq.cm` → 提示应为 `@qq.com`）
- **Commit**：`5a44677`

### 3. PDF 下载架构重构（重要）
**文件**：`backend/services/download_service.py`（完全重写）、`backend/routers/search.py`、`frontend/src/api/client.ts`、`frontend/src/components/ResultsPanel.tsx`

**根本问题**：服务器（中国 IP）被 arXiv / europepmc 等封锁，原来单 URL 代理全部失败。

**解决方案**：7 级 fallback 链，对标 paper-fetch 工具：
1. Primary `pdf_url`（原始链接）
2. Unpaywall API（按 DOI，合法 OA）
3. Semantic Scholar `openAccessPdf`（按 DOI）
4. arXiv 直链（从 paper_id 或 DOI 中提取 arXiv ID）
5. PMC 全文（pubmed_ paper_id → eutils 查 PMCID）
6. bioRxiv / medRxiv（按 DOI 查预印本，生命科学论文关键）
7. Sci-Hub 镜像（se/st/ru，HTML 解析嵌入 PDF URL，最后兜底）

**其他改进**：
- 用 SSRF 防护替换原来过窄的 ALLOWED_DOMAINS 白名单（阻止私有 IP + 非标准端口）
- 加 `%PDF` 魔数校验，确保拿到的是真正的 PDF
- 路由 `GET /api/download` 新增 `doi` 和 `paper_id` 参数（向后兼容）
- `getDownloadUrl()` 前端函数同步支持传 doi / paperId
- **Commits**：`0bc9aba`、`3aa5be8`

### 4. 单篇 PDF 按钮改为直链
**文件**：`frontend/src/components/PaperCard.tsx`
- 原来走服务器代理（被封） → 改为 `href={paper.pdf_url}` + `target="_blank"`
- 用户浏览器直接请求来源，绕过服务器 IP 限制
- **Commit**：`793336f`

### 5. 批量下载失败体验优化
**文件**：`frontend/src/components/ResultsPanel.tsx`
- 失败时 ZIP 包含两个文件：`手动下载链接.html`（带按钮可点击）+ `failed_downloads.csv`（含 PDF 直链列）
- 进度状态文案更新
- **Commits**：`e4e753c`、`506897a`

### 6. 留言板 Badge 修复
**文件**：`frontend/src/components/FeedbackWidget.tsx`
- 硬编码 `> 9 ? '9+' :` → 改为 `> 99 ? '99+' :`，显示真实数量
- **Commit**：`e4e753c`

---

## 关键文件位置

| 文件 | 用途 |
|------|------|
| `backend/services/search_service.py` | 10 源搜索 + 去重 + sanitize |
| `backend/services/download_service.py` | 7 级 PDF fallback 链 |
| `backend/services/email_service.py` | SMTP 邮件（验证 + 订阅日报） |
| `backend/services/llm_service.py` | AI 意图解析 / 相关性过滤 / 对比分析 |
| `backend/services/pdf_finder_service.py` | 备用链接生成 / Kimi 联网搜索 PDF |
| `backend/scheduler.py` | APScheduler 每日推送任务 |
| `backend/routers/subscriptions.py` | 订阅 CRUD + 队列 API |
| `backend/routers/search.py` | 搜索 + PDF 下载端点 |
| `backend/models_db.py` | DB 模型（含 Subscription / SubscriptionQueueItem） |
| `frontend/src/components/ResultsPanel.tsx` | 搜索结果 / 批量操作 |
| `frontend/src/components/PaperCard.tsx` | 单篇论文卡片 |
| `frontend/src/components/FeedbackWidget.tsx` | 留言板 |
| `frontend/src/components/AuthModal.tsx` | 注册 / 登录弹窗 |
| `frontend/src/pages/SubscriptionsPage.tsx` | 订阅管理页 |
| `frontend/src/api/client.ts` | API 封装（含 getDownloadUrl） |

---

## DB 模型概览

```python
User               id / email / password_hash / is_verified / free_searches_left
Subscription       id / user_id / keywords_json / active / daily_limit / last_sent
SubscriptionQueueItem  id / subscription_id / paper_json / paper_id / planned_date / sent_at
Bookmark           id / user_id / paper_json
ChatHistory        id / user_id / paper_id / paper_title / last_message / last_at
Feedback           id / content / location / is_author / user_id / reply_to_id / category / recalled
```

---

## API 端点概览

| 端点 | 说明 |
|------|------|
| `GET /api/search` | SSE 流式搜索 |
| `GET /api/download?url=&doi=&paper_id=` | PDF 下载（7 级 fallback） |
| `POST /api/auth/register` | 注册 |
| `POST /api/auth/login` | 登录 |
| `GET /api/auth/verify` | 邮件验证 |
| `GET /api/subscriptions` | 获取订阅列表 |
| `POST /api/subscriptions` | 新建订阅 |
| `GET /api/subscriptions/{id}/queue` | 查看推送队列 |
| `POST /api/subscriptions/{id}/refresh-queue` | 手动刷新队列 |
| `PATCH /api/subscriptions/{id}/daily-limit` | 修改每日推送数 |
| `DELETE /api/subscriptions/{id}` | 删除订阅 |
| `GET /api/feedback` | 获取留言 |
| `POST /api/feedback` | 提交留言 |

---

## 已知问题 / 待办

### 中优先级
- 批量 ZIP 下载：服务器 IP 被部分学术源封锁（已有 7 级 fallback 兜底，效果待上线验证）
- bundle 优化：main chunk gzip 约 130 KB，可考虑懒加载 SubscriptionsPage
- 队列 item 展示：缺来源徽章、发布年份、引用数
- 新建订阅后，从成功弹窗跳转到订阅页时，自动展开刚创建的订阅卡片

### 低优先级
- 更多模型支持（Claude / GPT）
- 用户统计面板
- 移动端 landing page 优化
- FeedbackWidget 轮询改 WebSocket
- 论文卡片年份分布 sparkline
- 抽屉宽度拖拽

---

## 设计决策记录

| 决策 | 原因 |
|------|------|
| 单篇 PDF 按钮改直链 | 服务器 IP 被封，浏览器直接请求来源更可靠 |
| 批量下载走服务器 fallback 链 | 需要收集字节打包 ZIP，必须走服务器 |
| 用 SSRF 防护替换 ALLOWED_DOMAINS | 原白名单太窄（很多合法 OA URL 被拦），SSRF 防护更安全也更灵活 |
| Sci-Hub 作为最后一级 fallback | 公开 Web 服务法律风险，但用户明确要求覆盖率最大化 |
| bioRxiv/medRxiv 加入 fallback | paper-fetch 对比发现缺失，生命科学论文关键来源 |
| 自己实现 fallback 链而非调用 paper-fetch | paper-fetch 是外部工具，集成麻烦；逻辑不复杂，原生实现更可控 |
| 订阅队列 planned_date 用 YYYY-MM-DD 字符串 | SQLite 无原生 Date 类型，字符串便于比较且可读 |
| populate_queue 用 search_days=90 做 auto-refill | 避免漏搜订阅创建后 30 天内发布但在 30 天窗口外的论文 |
| 每日发送走独立 AsyncSessionLocal | 定时任务不在请求上下文里，不能用依赖注入的 get_db |
| 跨组件导航用 window 自定义事件 | ResultsPanel 需触发 MainLayout 切换页面，避免 prop 层层传递 |
| 收藏按钮用 invisible 保持高度 | 登录后无副标题导致按钮比相邻按钮矮，visibility:hidden 保留占位 |
