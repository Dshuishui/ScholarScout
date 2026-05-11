# Phase 1 Design: 账号系统 + 收藏论文 + 阅读历史

Date: 2026-05-11  
Status: Approved

## 目标

为 ScholarScout 添加可选的用户账号系统，登录后获得论文收藏夹和阅读历史功能。未登录用户的搜索体验保持不变。

---

## 数据库

**技术选型：** SQLite + SQLAlchemy (async)  
理由：零配置，当前访问量（~34 DAU）远未触及上限，后续可平滑迁移 PostgreSQL。

**表结构：**

```sql
users
  id          INTEGER PRIMARY KEY
  email       TEXT UNIQUE NOT NULL
  password_hash TEXT NOT NULL        -- bcrypt
  created_at  DATETIME DEFAULT NOW

saved_papers
  id              INTEGER PRIMARY KEY
  user_id         INTEGER REFERENCES users(id)
  paper_id_hash   TEXT NOT NULL      -- DOI 优先，否则 SHA256(normalized_title)
  paper_json      TEXT NOT NULL      -- 完整论文对象序列化为 JSON
  saved_at        DATETIME DEFAULT NOW
  UNIQUE(user_id, paper_id_hash)    -- 防重复收藏

reading_history
  id          INTEGER PRIMARY KEY
  user_id     INTEGER REFERENCES users(id)
  paper_json  TEXT NOT NULL
  viewed_at   DATETIME DEFAULT NOW
```

---

## 认证方案

- **JWT**，access token 有效期 7 天，存 `localStorage`
- 注册后直接可用，**不强制邮件验证**（v1 简化，后续可加）
- 密码用 `bcrypt` hash

**端点：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 邮箱+密码注册 |
| POST | /api/auth/login    | 登录，返回 JWT |
| GET  | /api/auth/me       | 获取当前用户信息（需 token）|

---

## 收藏 & 历史

**端点：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET    | /api/user/saved          | 获取收藏列表 |
| POST   | /api/user/saved          | 收藏一篇论文 |
| DELETE | /api/user/saved/{id}     | 取消收藏 |
| GET    | /api/user/history        | 获取阅读历史（最近 100 条）|
| POST   | /api/user/history        | 记录一次查看 |

请求 body 统一传完整论文对象（JSON），后端存储。

---

## 后端新增文件

```
backend/
  database.py              # SQLAlchemy async engine + session
  models_db.py             # User, SavedPaper, ReadingHistory 表
  routers/auth.py          # 注册 / 登录 / me
  routers/user.py          # 收藏 / 历史
  services/auth_service.py # bcrypt hash / JWT encode-decode
```

`main.py` 新增：
```python
app.include_router(auth.router, prefix="/api/auth")
app.include_router(user.router, prefix="/api/user")
```

---

## 前端新增文件

```
frontend/src/
  hooks/useAuth.ts          # 登录状态、token、register/login/logout
  components/AuthModal.tsx  # 登录/注册弹窗（tab 切换）
  components/UserMenu.tsx   # 右上角头像 + 下拉菜单（收藏夹/历史/登出）
  pages/SavedPage.tsx       # 收藏夹：复用 PaperCard 组件展示
  pages/HistoryPage.tsx     # 阅读历史：同上
```

**MainLayout.tsx** 改动：
- 右上角加 `UserMenu`（未登录显示"登录"按钮，已登录显示头像）
- 打开论文 AI 对话时，自动调用 POST /api/user/history 记录

**PaperCard.tsx** 改动：
- 右上角加书签图标，已登录时可点击收藏/取消收藏
- 未登录点击书签 → 弹出 AuthModal

---

## 路由

新增两个前端路由（React Router 或直接在 MainLayout 内切换 tab）：
- `/saved` — 收藏夹
- `/history` — 阅读历史

---

## 安全

- bcrypt rounds=12
- JWT secret 从环境变量读取（`JWT_SECRET`）
- 所有 /api/user/* 端点需验证 Bearer token，401 未授权
- 邮箱和密码长度限制（Pydantic 校验）
- 密码最小 8 位

---

## 不在此次范围内

- 邮件验证（Phase 1 跳过）
- 忘记密码 / 重置密码
- OAuth（GitHub/Google 登录）
- 收藏夹分组 / 标签
- Phase 2 订阅提醒
- Phase 3 AI 升级
