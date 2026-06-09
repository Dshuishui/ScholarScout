# ScholarScout 开发进度

> 压缩上下文后读这个文件快速入状态。最后更新：2026-06-09（Session 9）

---

## 项目概况

- **线上地址**：http://118.25.192.117
- **服务器**：ubuntu@118.25.192.117，仓库在 `/home/ubuntu/Github/ScholarScout`
- **部署**：`bash deploy/deploy.sh`（git pull → uv sync --frozen → npm build → rsync → systemctl restart）
- **GitHub**：https://github.com/Dshuishui/ScholarScout
- **最新 commit**：`0b061e2` fix(search): retry once after 429 for arXiv and Semantic Scholar

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
- 代码分割（首屏 gzip ~125 KB，SubscriptionsPage 独立分包）
- 留言板 + 新留言邮件通知作者（dyucong@email.ncu.edu.cn）

---

## Session 9 完成的工作（2026-06-09）

### 1. PDF 下载大幅改进
**文件**：`backend/services/download_service.py`、`backend/services/search_service.py`、`frontend/src/components/ResultsPanel.tsx`

- `_extract_pdf_url_from_html()`：遇到 HTML 落地页时自动提取 PDF 链接
  - 优先级：`citation_pdf_url` meta 标签（arXiv/bioRxiv/Springer/Wiley 等均支持）→ `link[type=application/pdf]` → `.pdf` href
  - `_fetch_bytes()` 遇到 HTML 不再直接报错，解析后重试（最多 2 层）
- `_normalize_pdf_url()`：搜索时就把落地页转直链
  - arXiv `abs/` → `pdf/`
  - bioRxiv/medRxiv content page → `.full.pdf`（去掉查询参数再拼）
- `selectedWithPdf`：从只选有 `pdf_url` 的论文，改为也包含只有 `url` 的论文
- 下载时使用 `paper.pdf_url || paper.url`，落地页也能走 HTML 解析路径
- **Commits**：`df37776`、`d6210f5`、`8aac91a`

### 2. 服务器代理配置
**文件**：`/etc/systemd/system/scholarscout-backend.service`（服务器上）

```ini
Environment="HTTP_PROXY=http://127.0.0.1:7890"
Environment="HTTPS_PROXY=http://127.0.0.1:7890"
```

服务器 127.0.0.1:7890 是 Clash 代理，让后端出口绕过中国 IP 封锁。

### 3. 新留言邮件通知
**文件**：`backend/services/email_service.py`、`backend/routers/feedback.py`

- 用户（非作者）发留言时，异步发邮件通知 `dyucong@email.ncu.edu.cn`
- `is_author=True` 的留言（作者自己的回复）不触发通知
- **Commit**：`a9e5471`

### 4. 订阅队列 item 展示增强
**文件**：`backend/routers/subscriptions.py`、`frontend/src/pages/SubscriptionsPage.tsx`

- 后端 `QueueItemOut` 新增 `source`、`year`、`citations` 字段，从 `paper_json` 里提取
- 前端队列列表每条 item 下方显示来源徽章（蓝色）、年份、引用数
- **Commit**：`4ee0e05`

### 5. 新建订阅后自动展开
**文件**：`frontend/src/components/ResultsPanel.tsx`、`frontend/src/components/MainLayout.tsx`、`frontend/src/pages/SubscriptionsPage.tsx`

- 订阅成功弹窗点「查看订阅管理」时，携带 `expandId` 跳转
- `SubscriptionsPage` 接收 `initialExpandId` prop，挂载后自动展开并拉取队列
- `navigate:page` 事件 detail 从纯字符串改为 `{ page, expandId }` 对象（兼容旧字符串格式）
- **Commit**：`4ee0e05`

### 6. Bundle 懒加载
**文件**：`frontend/src/components/MainLayout.tsx`

- `SubscriptionsPage` 改为 `lazy()` 动态导入，独立分包 13.5 KB
- 主包 gzip 从 130 KB 降到 124.9 KB
- **Commit**：`4ee0e05`

### 7. CI 测试修复
**文件**：`backend/tests/test_download_service.py`

- 旧测试基于白名单逻辑，重写后不匹配
- `test_fetch_pdf_bytes_invalid_url`：error match 改为 `"不安全地址"`
- `test_fetch_pdf_bytes_blocked_domain` 改为 `test_fetch_pdf_bytes_blocked_private_ip`，用私有 IP 测试 SSRF
- **Commit**：`bc7b007`

### 8. 搜索 429 重试逻辑
**文件**：`backend/services/search_service.py`

- 新增 `_get_with_retry()`：遇到 429 读 `Retry-After` 头（默认 5s，最多等 10s），重试一次
- 应用到 `_search_arxiv()` 和 `_search_semantic_scholar()`（这两个来源最常触发限速）
- arXiv timeout 从 20s 改为 25s（给重试留余量）
- **Commit**：`0b061e2`

---

## 关键发现：搜索来源限速问题

通过实际测试（在服务器上运行 Python）发现：

| 来源 | 状态 | 原因 |
|------|------|------|
| arXiv | 429（持续性） | 测试时频繁请求触发限速，可能需数小时恢复 |
| Semantic Scholar | 429（持续性） | 免费匿名 ~100 次/5分钟，多用户易触发 |
| OpenAlex | ✅ 200 | 正常 |
| PubMed | ✅ 200 | 正常 |
| Europe PMC | ✅ 200 | 正常 |
| INSPIRE-HEP | ✅ 200 | 正常 |
| CrossRef | ✅ 200 | 正常 |

**根本解法**：申请 Semantic Scholar 免费 API Key（免费额度 1000 次/分钟）。用户暂缓此项，先观察重试逻辑效果。

---

## 关键文件位置

| 文件 | 用途 |
|------|------|
| `backend/services/search_service.py` | 10 源搜索 + 去重 + sanitize + 429 重试 |
| `backend/services/download_service.py` | 7 级 PDF fallback + HTML 落地页解析 |
| `backend/services/email_service.py` | SMTP 邮件（验证 + 订阅日报 + 留言通知） |
| `backend/services/llm_service.py` | AI 意图解析 / 相关性过滤 / 对比分析 |
| `backend/scheduler.py` | APScheduler 每日推送任务 |
| `backend/routers/subscriptions.py` | 订阅 CRUD + 队列 API（含 source/year/citations） |
| `backend/routers/search.py` | 搜索 + PDF 下载端点 |
| `backend/routers/feedback.py` | 留言板 + 新留言邮件通知 |
| `frontend/src/components/ResultsPanel.tsx` | 搜索结果 / 批量操作 |
| `frontend/src/components/PaperCard.tsx` | 单篇论文卡片 |
| `frontend/src/components/MainLayout.tsx` | 页面布局 + 导航事件处理 |
| `frontend/src/pages/SubscriptionsPage.tsx` | 订阅管理页（含 initialExpandId） |
| `frontend/src/api/client.ts` | API 封装 |

---

## systemd 服务文件（重要）

`/etc/systemd/system/scholarscout-backend.service` 关键配置：

```ini
[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/Github/ScholarScout/backend
ExecStart=/home/ubuntu/Github/ScholarScout/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5
Environment="HTTP_PROXY=http://127.0.0.1:7890"
Environment="HTTPS_PROXY=http://127.0.0.1:7890"
```

代理依赖 Clash 进程（127.0.0.1:7890）持续运行。

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
| `GET /api/download?url=&doi=&paper_id=` | PDF 下载（7 级 fallback + HTML 解析） |
| `POST /api/auth/register` | 注册 |
| `POST /api/auth/login` | 登录 |
| `GET /api/auth/verify` | 邮件验证 |
| `GET /api/subscriptions` | 获取订阅列表 |
| `POST /api/subscriptions` | 新建订阅 |
| `GET /api/subscriptions/{id}/queue` | 查看推送队列（含 source/year/citations） |
| `POST /api/subscriptions/{id}/refresh-queue` | 手动刷新队列 |
| `PATCH /api/subscriptions/{id}/daily-limit` | 修改每日推送数 |
| `DELETE /api/subscriptions/{id}` | 删除订阅 |
| `GET /api/feedback` | 获取留言 |
| `POST /api/feedback` | 提交留言（非作者自动邮件通知） |

---

## 已知问题 / 待办

### 中优先级
- arXiv / Semantic Scholar 限速（429）：重试逻辑已加，等服务器 IP 限速窗口自然恢复后验证效果
- Semantic Scholar 根本解法：申请免费 API Key（用户暂缓）

### 低优先级
- 更多模型支持（Claude / GPT）
- 用户统计面板
- 移动端 landing page 优化
- FeedbackWidget 轮询改 WebSocket
- 论文卡片年份分布 sparkline

---

## 设计决策记录

| 决策 | 原因 |
|------|------|
| 单篇 PDF 按钮改直链 | 服务器 IP 被封，浏览器直接请求更可靠 |
| 批量下载走服务器 fallback 链 | 需要收集字节打包 ZIP，必须走服务器 |
| SSRF 防护替换 ALLOWED_DOMAINS | 原白名单太窄，SSRF 防护更安全更灵活 |
| HTML 落地页解析而非直接拒绝 | 很多来源 pdf_url 是落地页，citation_pdf_url meta 标签是学术出版商标准 |
| paper.url 作为 pdf_url 缺失时的兜底 | 增加覆盖范围，落地页同样能走解析路径 |
| Sci-Hub 作为最后一级 fallback | 公开 Web 服务，用户要求覆盖率最大化 |
| 代理配置在 systemd 而非代码 | 不污染代码，代理换端口只改 service 文件 |
| 429 重试最多等 10s | 避免搜索总耗时过长，超时了直接返回空 |
| navigate:page 事件兼容新旧格式 | 防止其他地方派发旧格式字符串时出错 |
| 订阅页懒加载 | 首屏不需要，分包减少主包体积 |
