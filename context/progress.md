# ScholarScout 开发进度

> 压缩上下文后读这个文件快速入状态。最后更新：2026-05-23（Session 6）

---

## 项目概况

- **线上地址**：http://118.25.192.117
- **服务器**：ubuntu@118.25.192.117，仓库在 `/home/ubuntu/Github/ScholarScout`
- **部署**：`bash deploy/deploy.sh`（git pull → uv sync --frozen → npm build → rsync → systemctl restart）
- **GitHub**：https://github.com/Dshuishui/ScholarScout
- **最新 commit**：`8a5af44` fix(card): hide 'login to use' subtitle on bookmark btn when logged in

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

### 账号系统 & 邮箱验证（Session 5）
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

### 搜索结果面板（ResultsPanel）
- 顶部摘要行；💬 已对话 badge；排序/筛选/分组/分页/密度切换
- **导出 CSV 选项**：新增"仅导出 AI 筛选后论文"checkbox（默认勾选）；弹窗实时显示"将导出 N 篇论文"

### KeySetupScreen 落地页（Session 6 新增）
- **双入口设计**：
  - 主入口（上方）：⚡ 免费体验卡片，点击弹 AuthModal（注册 tab）
  - 次入口（下方）：API Key 输入（原流程，降级为次要入口）
  - 分隔线："── 或使用自己的 Key ──"
- **已登录 + 0 次额度**：显示 amber 提示卡，含当前账号邮箱 + "切换账号"（logout）按钮
- **AuthModal**：新增 `defaultTab` prop，注册卡片点击直接打开注册 tab

### 论文卡片收藏按钮（Session 6 新增）
- **未登录**：显示"收藏" + "登录后使用"副文字
- **已登录未收藏**：只显示"收藏"，无副文字
- **已登录已收藏**：显示"已收藏" + "点击取消"

### Phase 2：订阅 + 邮件推送
- 订阅关键词组合，每天 08:00 CST 推送新论文邮件
- 订阅管理页（开关/删除/测试发送）
- 当前 UX 问题：见【待做事项 → 订阅 UX 优化】

### Phase 3：AI 多论文分析（ComparePanel）
- 勾选 2+ 篇论文 → AI 多论文分析（对比/综述/趋势）
- 各模式独立 useRef 缓存；强制刷新用"重新生成"

### 导航与布局（MainLayout）
- 可折叠侧边栏（384px → 0px 动画）；Drawer Push（margin-right: 440px）
- **移动端响应式**（Session 4）：底部 Tab Bar（搜索/结果）；PaperChatDrawer → 88vh 底部 Sheet

### 搜索对话面板（ChatPanel）
- 分领域示例引导；示例点击直接触发搜索；可折叠历史对话

### 留言板（FeedbackWidget）
- 3 Tab（建议/反馈/聊天）；category 字段过滤；各 tab 独立计数；Emoji 反应；昵称

### 性能优化（Session 5）
- **Bundle 代码分割**：ComparePanel + PaperChatDrawer 改为 `React.lazy`
  - 首屏主 bundle gzip：177KB → **126KB**（-29%）

### CI / 工程（Session 6）
- **修复 CI 失败**：测试用例未随 Session 5 邮箱验证改动更新
  - `conftest.py` 加 `make_verified_user()` helper + `reset_rate_limits` autouse fixture
  - `test_auth.py` / `test_user.py` 全部更新为直接写 DB 绕过邮件流程
- **uv.lock 修复**：`aiosmtplib`/`apscheduler` 缺 top-level 条目 → 重新 `uv lock` 补全
  - `deploy.sh` 改为 `uv sync --no-dev --frozen`，移除 `git checkout` workaround

### README（Session 6）
- 中英文均更新：免费试用说明（注册验证邮箱获 3 次）、双路径使用方法、完整功能列表

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

---

## 关键文件位置

```
frontend/src/
  App.tsx                   — 邮箱验证回调（?verify=token）+ 试用模式入口判断
  api/client.ts             — parseQuery/searchPapers 支持 authToken（试用模式）
  components/
    MainLayout.tsx          — 主布局；height:100% wrapper 修复
    ChatPanel.tsx           — 示例直接搜索；可折叠历史
    ResultsPanel.tsx        — 导出 aiOnly 选项；ComparePanel lazy；订阅按钮
    PaperCard.tsx           — 收藏按钮按登录状态显示；useAuth() 直接调用
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

backend/
  models_db.py              — User: is_verified/verify_token/verify_token_expires/free_searches
  database.py               — ALTER TABLE 迁移（含 4 个新 User 字段）
  config.py                 — DEEPSEEK_SYSTEM_KEY / FREE_SEARCHES_QUOTA / APP_BASE_URL
  dependencies.py           — get_optional_user()（无 token 返回 None，不抛异常）
  routers/auth.py           — 完整验证流程：register/verify-email/login/resend-verification/me
  routers/search.py         — _resolve_api_key()；/parse 检查额度不扣减；/search 原子扣减
  routers/subscriptions.py  — 订阅 CRUD（当前实现，待优化 UX）
  models.py                 — SearchRequest/ParseRequest.api_key 改为 Optional
  services/email_service.py — send_verification_email() + send_subscription_email()
  routers/user.py           — /me 返回 free_searches
  scheduler.py              — 每日定时任务（08:00 CST 推送订阅邮件）
  tests/
    conftest.py             — make_verified_user() helper + reset_rate_limits autouse
    test_auth.py            — 已更新匹配邮箱验证流程
    test_user.py            — register_and_token → get_auth_headers（直接写 DB）
```

---

## 待做事项

### 🔥 下一步：订阅 UX 优化

**问题描述**：当前订阅体验不够清晰。用户点击"订阅更新"按钮后，按钮变为"已订阅"，仅此而已——没有解释订阅了什么、何时收到邮件、邮件长什么样。用户不知道"订阅完成"意味着什么。

**现有实现**（`ResultsPanel.tsx`）：
- 按钮位置：关键词 chips 行右侧
- 点击后：POST `/api/subscriptions`，按钮变绿显示"已订阅"
- 无任何 toast / 弹窗 / 说明文字
- 订阅管理入口：UserMenu → 订阅管理页

**参考方向**（下一个 session 实现前先调研）：
- **Google Scholar 快讯**：订阅成功后弹窗确认，说明推送频率（实时/每天/每周）、预计首次推送时间、可在何处管理
- **ResearchGate**：邮件通知有明确的"你订阅了 X，下次推送时间是 Y"说明
- **Connected Papers / Semantic Scholar**：订阅确认卡片/toast，含跳转"管理订阅"链接

**改进方案（草案，待细化）**：

1. **订阅成功反馈弹窗（SubscribeSuccessModal 或 toast+）**
   - 标题：✅ 订阅成功！
   - 内容：
     - 已订阅关键词：`RAG · retrieval augmented generation`
     - 推送频率：每天 08:00（北京时间）
     - 你将收到：过去 24 小时内的新论文摘要邮件
     - 发送到：`user@email.com`
   - 按钮：[查看订阅管理] [知道了]

2. **按钮附近加说明文字**
   - 未订阅时 hover tooltip 改为："每天 08:00 推送新论文到你的邮箱"
   - 或在按钮下方常驻显示小字："每日推送 · 可随时取消"

3. **首次订阅引导**
   - 如果用户从未订阅过（`subscriptions.length === 0`），第一次点击后弹完整说明弹窗
   - 之后订阅只显示 toast

**后端现状**：
- `POST /api/subscriptions`：创建订阅，返回 `{ id, keywords }`
- `scheduler.py`：APScheduler 每天 00:00 UTC 触发，调 `send_subscription_email()`
- 邮件模板在 `email_service.py`（`build_email_html`）

**实现优先级**：方案 1（成功弹窗）为主，方案 2（说明文字）同步添加，方案 3 可选。

---

### 优先级低（可选功能）

- [ ] 更多模型支持（Claude、GPT 等）
- [ ] 用户主页：统计已收藏/已对话/已订阅数量
- [ ] 落地页（KeySetupScreen）移动端适配
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

# Umami 状态
sudo docker compose -f deploy/umami-compose.yml --env-file deploy/.umami.env ps
```

---

## Session 6 完成工作（2026-05-23）

### 1. CI 修复（f7090e0）
- 测试未随 Session 5 邮箱验证改动更新，register 不再返回 token 导致全部失败
- conftest 加 `make_verified_user()` + `reset_rate_limits`；test_auth/test_user 全更新

### 2. uv.lock 修复 + deploy.sh 改进（c870d09）
- `aiosmtplib`/`apscheduler` 缺 top-level lock 条目 → 服务器每次 uv sync 都修改文件
- 重新 `uv lock`，deploy.sh 改为 `--frozen`，移除 git checkout workaround

### 3. KeySetupScreen 双入口改造（e7692d0）
- 免费试用卡片（主 CTA）+ 分隔线 + API Key 输入（次要）
- AuthModal 加 `defaultTab` prop
- 已登录+0次：amber 提示含邮箱显示 + "切换账号"按钮

### 4. Bug 修复系列
- toast 文案修正：`data.free_searches ?? 3` → 正确处理 0 值（278210b）
- amber 提示加账号信息（f7603b8）
- 收藏按钮：已登录时不再显示"登录后使用"（8a5af44）

### 5. README 更新（45874f2）
- 中英双语：免费试用入口、双路径使用方法、完整功能/状态列表
