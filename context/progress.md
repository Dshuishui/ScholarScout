# ScholarScout 开发进度

> 压缩上下文后读这个文件快速入状态。最后更新：2026-05-27（Session 7）

---

## 项目概况

- **线上地址**：http://118.25.192.117
- **服务器**：ubuntu@118.25.192.117，仓库在 `/home/ubuntu/Github/ScholarScout`
- **部署**：`bash deploy/deploy.sh`（git pull → uv sync --frozen → npm build → rsync → systemctl restart）
- **GitHub**：https://github.com/Dshuishui/ScholarScout
- **最新 commit**：`af2c1c5` fix: 3 subscription bugs + README multi-paper AI analysis

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

### 核心搜索
- 自然语言 → AI 提取关键词 → 立即搜索 → 展示结果
- 10 源并发搜索，SSE 实时进度可视化（per-source spinner/✓ + 篇数）
- AI 筛选后 0 篇时显示引导卡片；搜索失败时显示重试卡片
- 关键词 chips 可编辑 + 重新搜索

### 账号系统 & 邮箱验证
- JWT 注册/登录（30 天过期），401 自动退出 + toast"登录已过期"
- **邮箱验证流程**：注册后发验证邮件 → 点击链接激活 → 自动登录
  - token：`secrets.token_urlsafe(32)`（256-bit），24h 过期，单次有效
  - 老用户：ALTER TABLE DEFAULT 1，保持 `is_verified=True`，无需重新验证
- **免费试用额度**：验证后赠送 3 次免费搜索（系统 Key 代付）
  - 后端原子扣减：`UPDATE ... WHERE free_searches > 0`（防并发超额）
  - 系统 Key 仅服务器端使用，从不暴露给前端
  - 服务器 `.env` 必须有 `DEEPSEEK_SYSTEM_KEY` 和 `APP_BASE_URL=http://118.25.192.117`
- **限流（内存）**：注册 5次/小时/IP；登录失败 10次/15min/IP；重发验证 3次/小时/邮箱
- 收藏论文（乐观更新，localStorage 缓存 `ss_saved_map`）
- AI 对话记录持久化（每篇论文独立，重新打开自动恢复）

### 论文 AI 对话（PaperChatDrawer）
- 基于标题/摘要；上传 PDF 后基于全文
- **PDF 全文字符上限**：`MAX_CHARS = 3_936_000`
- **PDF 云端持久化**：PDF 文本存入后端 DB，与账号绑定，刷新/换设备自动恢复
- **PDF 注入方式**：模拟 Claude.ai document block
- **Drag&Drop PDF 上传**；**清除 PDF**（× 按钮保留对话）；**新建会话**（保留 PDF）
- **重新生成**；**快捷提问**；Markdown 渲染；Stop 按钮

### 多论文 AI 分析（ComparePanel，主推功能）
- 勾选 2+ 篇论文 → 全屏分析面板，三种模式：
  - **对比分析**：汇总表格 + 方法/创新点/实验/优缺点逐项对比
  - **文献综述**：学术段落，可直接用作 Related Work 草稿
  - **研究趋势**：时间线演进 + 未来方向预测
- 各模式独立 `useRef` 缓存（切换不丢失）；支持 Stop + 重新生成
- ComparePanel lazy loaded（减小首屏 bundle）

### 搜索结果面板（ResultsPanel）
- 顶部摘要行；💬 已对话 badge；排序/筛选/分组/分页/密度切换
- **导出 CSV**：仅导出 AI 筛选后论文（默认）或全部；弹窗实时显示导出篇数

### KeySetupScreen 落地页
- **双入口设计**：
  - 主入口：⚡ 免费体验卡片，点击弹 AuthModal（注册 tab）
  - 次入口：API Key 输入，分隔线隔开
- **已登录 + 0 次额度**：amber 提示卡含账号邮箱 + "切换账号"按钮
- **AuthModal**：`defaultTab` prop，注册卡片直接打开注册 tab

### 论文卡片收藏按钮
- **未登录**：显示"收藏" + "登录后使用"副文字
- **已登录未收藏**：只显示"收藏"，副文字 `invisible` 占位（保持按钮高度对齐）
- **已登录已收藏**：显示"已收藏" + "点击取消"

### 📬 关键词订阅 + 每日推送队列（Session 7，主推功能）

#### 核心机制
- 订阅关键词 → 后台异步搜索论文（BackgroundTasks）→ 建推送队列
- 调度器每天 00:00 UTC（08:00 CST）从队列取 `daily_limit` 篇 → 发邮件 → 标记 sent_at
- 队列剩余 < 5 篇时自动补充（search_days=90 宽窗口）；队列空时同上

#### DB 模型
```python
class Subscription:
    id, user_id, keywords_json, active, created_at, last_sent
    daily_limit: int = 1  # 每天推送篇数（用户可调 1-10）

class SubscriptionQueueItem:
    id, subscription_id, paper_json, paper_id  # paper_id 用于去重
    planned_date: str  # YYYY-MM-DD
    sent_at: datetime | None
    created_at: datetime
```

#### 迁移
- `ALTER TABLE subscriptions ADD COLUMN daily_limit INTEGER DEFAULT 1`
- `subscription_queue` 表由 `create_all` 自动创建

#### API 端点
```
GET  /api/subscriptions                    — 列表
POST /api/subscriptions                    — 创建（后台触发填充队列）
DELETE /api/subscriptions/{id}             — 删除（同时删队列项）
PATCH /api/subscriptions/{id}/toggle       — 开关
PATCH /api/subscriptions/{id}/daily-limit  — 修改每日篇数
GET  /api/subscriptions/{id}/queue         — 查看队列（sent + pending）
POST /api/subscriptions/{id}/refresh-queue — 后台重新搜索并追加
POST /api/subscriptions/{id}/test-send     — 测试发送（不走队列，已从前端移除按钮）
```

#### 前端
- **ResultsPanel**：订阅成功后弹确认 Modal（关键词 chips + 推送时间 + 接收邮箱 + 跳转管理）
- **ResultsPanel**：订阅按钮下方常驻提示文字"每日推送 · 可随时取消"
- **MainLayout**：监听 `navigate:page` custom event → setActivePage（跨组件导航不需要 prop drilling）
- **SubscriptionsPage**：可展开队列面板（✅ 已发 + 📅 待发 + 🕐 今天），显示已发/待发篇数
- **SubscriptionsPage**：每日篇数内联编辑（点击数字 → input → 保存/取消）
- **SubscriptionsPage**：队列空 + 创建 < 3 分钟 → 显示"正在后台搜索..."spinner；> 3 分钟 → 显示"已清空，点击刷新"
- **邮件模板**：周报→日报，"下周一"→"明天早 8 点（北京时间 08:00）"；单篇推送展开完整摘要

#### populate_queue 逻辑
```python
async def populate_queue(sub, db, now, search_days=30, max_add=30):
    # 1. 搜索近 search_days 天论文（初始: 30天，自动刷新: 90天）
    # 2. 可选 AI 过滤
    # 3. 过滤已在队列中的 paper_id（已发和待发都去重）
    # 4. 找最后一个 pending 的 planned_date，从其后一天开始排队
    #    每天排 daily_limit 篇（i // daily_limit 天偏移）
    # 5. 最多追加 max_add 篇
```

### 导航与布局（MainLayout）
- 可折叠侧边栏（384px → 0px 动画）；Drawer Push（margin-right: 440px）
- **移动端响应式**：底部 Tab Bar（搜索/结果）；PaperChatDrawer → 88vh 底部 Sheet
- `navigate:page` custom event 监听（Session 7 新增）

### 搜索对话面板（ChatPanel）
- 分领域示例引导；示例点击直接触发搜索；可折叠历史对话

### 留言板（FeedbackWidget）
- 3 Tab（建议/反馈/聊天）；category 字段过滤；各 tab 独立计数；Emoji 反应；昵称

### 性能
- **Bundle 代码分割**：ComparePanel + PaperChatDrawer → `React.lazy`
- 首屏主 bundle gzip：**129.73 KB**（Session 7 订阅页新代码略有增加，Session 5 时是 126KB）

### CI / 工程
- pytest-asyncio `asyncio_mode = "auto"`；`make_verified_user()` helper；`reset_rate_limits` autouse fixture
- `uv sync --no-dev --frozen` in deploy.sh（lock 不匹配 fail-fast）

---

## 重要设计决策

| 决策 | 原因 |
|------|------|
| `pdfTextsRef` 用 `useRef` 不用 `useState` | 避免 `sendMessage` useCallback 闭包捕获过期值 |
| PDF 文本存后端 DB | 跟账号绑定，换设备/刷新均可恢复 |
| PDF 作为对话时间线节点（非 system prompt）| 模拟 Claude.ai document block |
| Drawer push 用 `margin-right: 440px` | 不遮盖 ResultsPanel |
| ComparePanel 用 `useRef` 缓存各模式结果 | 避免重复付费 API 调用 |
| FeedbackWidget category 存后端 | 客户端正则无法可靠分类 |
| Emoji 反应存 localStorage | 避免后端复杂度，后续可升级 |
| `update_pdf: bool` 标志位 | 区分"不传 pdf_text"和"明确清空" |
| 邮箱验证 token 用 `secrets.token_urlsafe(32)` | 256-bit 熵，暴力破解不可行 |
| parse 阶段不扣减试用额度，只在 search 扣 | 一次完整搜索（parse+search）算一次 |
| 限流用内存 dict | 小规模部署够用，生产级换 Redis |
| 试用 Key 仅服务器端 env var | 绝不暴露给前端 |
| 老用户 ALTER TABLE DEFAULT 1 | 保持已注册用户正常登录，无需重新验证 |
| 测试用 make_verified_user() 直接写 DB | 绕过 SMTP，测试不依赖邮件服务 |
| uv sync --frozen in deploy | lock 文件不匹配时 fail-fast 而非静默修改 |
| PaperCard 内用 useAuth() 而非传 prop | 不需要改所有调用方 |
| 收藏按钮副文字用 `invisible` 而非条件渲染 | 保持按钮高度与相邻按钮对齐 |
| 订阅队列用 BackgroundTasks 异步填充 | 不阻塞 POST /subscriptions 响应 |
| 自动刷新队列 search_days=90 | 初始填充仅覆盖 30 天，刷新用更宽窗口避免漏搜 |
| navigate:page custom event | 跨层组件导航（ResultsPanel → MainLayout），不需要 prop drilling |
| 移除测试发送按钮 | 日常推送已稳定，按钮为调试遗留，去掉减少 UI 噪音 |
| 队列创建 3 分钟内显示 populating 状态 | 区分"真空"和"后台还在跑"，避免用户误以为出错 |

---

## 关键文件位置

```
frontend/src/
  App.tsx                   — 邮箱验证回调（?verify=token）+ 试用模式入口判断
  api/client.ts             — parseQuery/searchPapers 支持 authToken（试用模式）
  components/
    MainLayout.tsx          — 主布局；navigate:page event listener（Session 7）
    ChatPanel.tsx           — 示例直接搜索；可折叠历史
    ResultsPanel.tsx        — 订阅成功 Modal；navigate:page dispatch；订阅按钮提示文字
    PaperCard.tsx           — 收藏按钮 invisible 占位（Session 7）；useAuth() 直接调用
    PaperChatDrawer.tsx     — 论文 AI 对话；移动端底部 Sheet；lazy
    KeySetupScreen.tsx      — 双入口（免费试用卡 + API Key）；已登录态 amber 提示
    AuthModal.tsx           — defaultTab prop；注册后"邮件已发送"态 + 重发按钮
    UserMenu.tsx            — 头像徽章显示剩余免费次数；下拉菜单"⚡ 剩余 N 次"
    FeedbackWidget.tsx      — 3 Tab + category 字段过滤
    ComparePanel.tsx        — 多论文分析（lazy loaded）
  hooks/
    useAuth.ts              — freeSearches；register 返回 message 不自动登录；
                              loginWithToken；resendVerification；decrementFreeSearches
    usePaperChat.ts         — regenerate()；removePdf()；错误提示
    useSearch.ts            — isTrial 判断；authToken 传递；done 时 decrementFreeSearches
    useIsMobile.ts          — resize-aware breakpoint hook
  pages/
    SubscriptionsPage.tsx   — 队列展开面板；daily_limit 编辑；populating 状态（Session 7）
    SavedPage.tsx           — 收藏夹
    HistoryPage.tsx         — 阅读历史

backend/
  models_db.py              — User / Subscription(+daily_limit) / SubscriptionQueueItem（Session 7）
  database.py               — ALTER TABLE 迁移（含 daily_limit）
  config.py                 — DEEPSEEK_SYSTEM_KEY / FREE_SEARCHES_QUOTA / APP_BASE_URL
  dependencies.py           — get_optional_user()（无 token 返回 None，不抛异常）
  routers/auth.py           — 完整验证流程：register/verify-email/login/resend-verification/me
  routers/search.py         — _resolve_api_key()；/parse 检查额度不扣减；/search 原子扣减
  routers/subscriptions.py  — 完整队列 CRUD（Session 7，含 AsyncSessionLocal 正确导入）
  models.py                 — SearchRequest/ParseRequest.api_key 改为 Optional
  services/email_service.py — 日报模板（Session 7）；send_verification_email()
  routers/user.py           — /me 返回 free_searches
  scheduler.py              — populate_queue() + _send_from_queue()（Session 7 完全重写）
  tests/
    conftest.py             — make_verified_user() helper + reset_rate_limits autouse
    test_auth.py            — 已更新匹配邮箱验证流程
    test_user.py            — register_and_token → get_auth_headers（直接写 DB）
```

---

## 待做事项

### 中优先级

- [ ] **Bundle 优化**：主包 gzip 129.73KB，可考虑 lazy load SubscriptionsPage
- [ ] **队列 item 显示更多信息**：加来源 badge、发表年份、引用数（当前只有标题+日期）
- [ ] **订阅管理跳转后自动展开新订阅**：用户从订阅成功 Modal 点"查看订阅管理"时，自动展开刚创建的订阅的队列（需在 navigate:page event 中传 subId）
- [ ] **邮件加"在 ScholarScout 中打开"按钮**：增加回访入口

### 低优先级

- [ ] 更多模型支持（Claude、GPT 等）
- [ ] 用户主页：统计已收藏/已对话/已订阅数量
- [ ] 落地页（KeySetupScreen）移动端适配
- [ ] 移动端 PDF 上传 UX（当前 Sheet 内操作不便）
- [ ] FeedbackWidget Emoji 反应后端持久化
- [ ] FeedbackWidget WebSocket 实时推送（目前 20s 轮询）
- [ ] 年份分布 sparkline
- [ ] Drawer 宽度可拖拽调整
- [ ] AI "引用原文"功能

---

## 维护命令

```bash
# 查看后端日志
sudo journalctl -u scholarscout-backend -n 50 --no-pager

# 重新部署
bash deploy/deploy.sh

# 重启后端
sudo systemctl restart scholarscout-backend

# 修改某个用户的 free_searches（无 sqlite3 命令时用 Python）
cd /home/ubuntu/Github/ScholarScout/backend
.venv/bin/python -c "
import sqlite3
conn = sqlite3.connect('scholarscout.db')
conn.execute(\"UPDATE users SET free_searches=3 WHERE email='xxx@xxx.com'\")
conn.commit()
print(conn.execute('SELECT email, free_searches FROM users').fetchall())
conn.close()
"

# Umami 统计面板
sudo docker compose -f deploy/umami-compose.yml --env-file deploy/.umami.env ps
```

---

## Session 7 完成工作（2026-05-23 ~ 2026-05-27）

### 1. 订阅成功 Modal（f93bb12）
- 点击"订阅更新"成功后弹确认弹窗：关键词 chips + 推送时间 + 邮箱 + 跳转管理
- 订阅按钮下方加小字"每日推送 · 可随时取消"
- MainLayout 监听 `navigate:page` custom event，支持跨组件跳转

### 2. 每日推送队列系统（8be31ed）
- 新增 `SubscriptionQueueItem` DB 表；`Subscription` 加 `daily_limit` 字段
- scheduler.py 完全重写：populate_queue + _send_from_queue
- 新增 API：GET queue / POST refresh-queue / PATCH daily-limit
- 创建订阅后 BackgroundTasks 异步填充队列
- 邮件模板重构：周报→日报，文案修正
- SubscriptionsPage：队列进度展示 + daily_limit 内联编辑 + 刷新按钮

### 3. UI 修复（be9ad7e）
- 收藏按钮高度对齐：用 `invisible` 替代条件渲染，三按钮等高
- 移除测试发送按钮（推送已稳定，按钮为调试遗留）

### 4. Bug 修复（af2c1c5）
- `__import__("database")` hack → `from database import AsyncSessionLocal`
- 自动刷新队列 search_days: 30 → 90（避免漏搜订阅后新论文）
- 队列空 + 创建 < 3 分钟 → 显示 spinner + 说明，而非误导性"队列为空"

### 5. README 更新（2db2f8b、af2c1c5）
- 订阅推送作为主推功能：扩写为 7 点详细列表
- 多论文 AI 分析升级为独立亮点章节（中英文同步）
- intro 同时提及两个主推功能
