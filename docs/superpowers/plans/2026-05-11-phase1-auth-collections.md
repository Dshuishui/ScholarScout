# Phase 1: Auth + Collections + History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional email/password auth to ScholarScout; logged-in users get paper collections and reading history.

**Architecture:** SQLite + SQLAlchemy async for storage; JWT in localStorage for auth; all new endpoints under `/api/auth/*` and `/api/user/*`; frontend adds AuthModal, UserMenu, bookmark button on PaperCard, SavedPage, and HistoryPage — search flow unchanged for unauthenticated users.

**Tech Stack:** Python `python-jose[cryptography]`, `passlib[bcrypt]`, `sqlalchemy[asyncio]`, `aiosqlite`, `email-validator`; React + TypeScript (no new packages)

---

## File Map

**Backend — create:**
- `backend/database.py` — async engine, session factory, `init_db()`
- `backend/models_db.py` — `User`, `SavedPaper`, `ReadingHistory` ORM models
- `backend/services/auth_service.py` — bcrypt + JWT helpers
- `backend/dependencies.py` — `get_current_user` FastAPI dependency
- `backend/routers/auth.py` — POST /register, POST /login, GET /me
- `backend/routers/user.py` — saved papers + reading history endpoints
- `backend/tests/conftest.py` — shared test fixtures (async DB + client)
- `backend/tests/test_auth.py` — auth endpoint tests
- `backend/tests/test_user.py` — saved/history endpoint tests

**Backend — modify:**
- `backend/main.py` — include new routers, call `init_db()` on startup
- `backend/config.py` — add `JWT_SECRET`

**Frontend — create:**
- `frontend/src/hooks/useAuth.ts` — login state, token, register/login/logout
- `frontend/src/components/AuthModal.tsx` — login/register modal
- `frontend/src/components/UserMenu.tsx` — top-right avatar + dropdown
- `frontend/src/pages/SavedPage.tsx` — saved papers list
- `frontend/src/pages/HistoryPage.tsx` — reading history list

**Frontend — modify:**
- `frontend/src/components/MainLayout.tsx` — add UserMenu; auto-record history on paper chat open
- `frontend/src/components/PaperCard.tsx` — add bookmark icon button

---

## Task 1: Install Backend Dependencies

**Files:** `backend/pyproject.toml`

- [ ] **Step 1: Add packages**

```bash
cd backend
uv add "python-jose[cryptography]" "passlib[bcrypt]" "sqlalchemy[asyncio]" aiosqlite email-validator
```

- [ ] **Step 2: Verify**

```bash
uv run python -c "from jose import jwt; from passlib.context import CryptContext; from sqlalchemy.ext.asyncio import create_async_engine; print('OK')"
```

Expected output: `OK`

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "chore: add auth and db dependencies"
```

---

## Task 2: Database Setup

**Files:**
- Create: `backend/database.py`
- Create: `backend/models_db.py`

- [ ] **Step 1: Create `backend/database.py`**

```python
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, DeclarativeBase

DATABASE_URL = "sqlite+aiosqlite:///./scholarscout.db"
engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
```

- [ ] **Step 2: Create `backend/models_db.py`**

```python
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, UniqueConstraint
from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class SavedPaper(Base):
    __tablename__ = "saved_papers"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False)
    paper_id_hash = Column(String(64), nullable=False)
    paper_json = Column(Text, nullable=False)
    saved_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("user_id", "paper_id_hash"),)


class ReadingHistory(Base):
    __tablename__ = "reading_history"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False)
    paper_json = Column(Text, nullable=False)
    viewed_at = Column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 3: Verify models load**

```bash
cd backend
uv run python -c "from models_db import User, SavedPaper, ReadingHistory; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/database.py backend/models_db.py
git commit -m "feat: add SQLite database models"
```

---

## Task 3: Auth Service (TDD)

**Files:**
- Create: `backend/services/auth_service.py`
- Create: `backend/tests/test_auth_service.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_auth_service.py`:

```python
import pytest
from services.auth_service import hash_password, verify_password, create_access_token, decode_token


def test_hash_and_verify_password():
    hashed = hash_password("mysecret123")
    assert verify_password("mysecret123", hashed)
    assert not verify_password("wrongpassword", hashed)


def test_hash_is_different_each_time():
    h1 = hash_password("same")
    h2 = hash_password("same")
    assert h1 != h2


def test_create_and_decode_token():
    token = create_access_token(42)
    assert decode_token(token) == 42


def test_decode_invalid_token_raises():
    from jose import JWTError
    with pytest.raises(JWTError):
        decode_token("not.a.valid.token")
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd backend
uv run pytest tests/test_auth_service.py -v
```

Expected: `ImportError` or `ModuleNotFoundError` (auth_service doesn't exist yet)

- [ ] **Step 3: Create `backend/services/auth_service.py`**

```python
import os
from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(user_id), "exp": expire}, JWT_SECRET, algorithm=ALGORITHM)


def decode_token(token: str) -> int:
    payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
    return int(payload["sub"])
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
cd backend
uv run pytest tests/test_auth_service.py -v
```

Expected: 4 tests PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/services/auth_service.py backend/tests/test_auth_service.py
git commit -m "feat: add auth service (bcrypt + JWT)"
```

---

## Task 4: Auth Dependency + Config

**Files:**
- Create: `backend/dependencies.py`
- Modify: `backend/config.py`

- [ ] **Step 1: Add JWT_SECRET to config**

In `backend/config.py`, append:

```python
import os as _os
JWT_SECRET = _os.environ.get("JWT_SECRET", "dev-secret-change-in-production")
```

- [ ] **Step 2: Create `backend/dependencies.py`**

```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError
from database import get_db
from models_db import User
from services.auth_service import decode_token

bearer = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        user_id = decode_token(credentials.credentials)
    except JWTError:
        raise HTTPException(status_code=401, detail="无效的认证凭据")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user
```

- [ ] **Step 3: Verify import**

```bash
cd backend
uv run python -c "from dependencies import get_current_user; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/dependencies.py backend/config.py
git commit -m "feat: add get_current_user dependency"
```

---

## Task 5: Auth Endpoints (TDD)

**Files:**
- Create: `backend/routers/auth.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_auth.py`

- [ ] **Step 1: Create `backend/tests/conftest.py`**

```python
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from main import app
from database import get_db
from models_db import Base

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def db_engine():
    engine = create_async_engine(TEST_DB_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db_session(db_engine):
    session_factory = sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
```

- [ ] **Step 2: Write failing auth tests**

Create `backend/tests/test_auth.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_register_success(client):
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 200
    assert "access_token" in r.json()


@pytest.mark.asyncio
async def test_register_duplicate_email(client):
    await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_register_short_password(client):
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "short"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_login_success(client):
    await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    r = await client.post("/api/auth/login", json={"email": "a@b.com", "password": "password123"})
    assert r.status_code == 200
    assert "access_token" in r.json()


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    r = await client.post("/api/auth/login", json={"email": "a@b.com", "password": "wrongpass"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_success(client):
    r = await client.post("/api/auth/register", json={"email": "a@b.com", "password": "password123"})
    token = r.json()["access_token"]
    r2 = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    assert r2.json()["email"] == "a@b.com"


@pytest.mark.asyncio
async def test_me_no_token(client):
    r = await client.get("/api/auth/me")
    assert r.status_code == 403
```

- [ ] **Step 3: Run and confirm failures**

```bash
cd backend
uv run pytest tests/test_auth.py -v
```

Expected: all FAILED (router not defined yet)

- [ ] **Step 4: Create `backend/routers/auth.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models_db import User
from services.auth_service import hash_password, verify_password, create_access_token
from dependencies import get_current_user

router = APIRouter()


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=100)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=100)


@router.post("/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="邮箱已注册")
    user = User(email=req.email, password_hash=hash_password(req.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}


@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="邮箱或密码错误")
    return {"access_token": create_access_token(user.id), "token_type": "bearer"}


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email}
```

- [ ] **Step 5: Wire router into main.py temporarily to allow conftest imports**

In `backend/main.py`, add before the last line:

```python
from routers import auth as auth_router
app.include_router(auth_router.router, prefix="/api/auth")
```

- [ ] **Step 6: Run tests and confirm pass**

```bash
cd backend
uv run pytest tests/test_auth.py -v
```

Expected: 7 tests PASSED

- [ ] **Step 7: Commit**

```bash
git add backend/routers/auth.py backend/tests/conftest.py backend/tests/test_auth.py backend/main.py
git commit -m "feat: add auth endpoints (register/login/me)"
```

---

## Task 6: Saved Papers + History Endpoints (TDD)

**Files:**
- Create: `backend/routers/user.py`
- Create: `backend/tests/test_user.py`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_user.py`:

```python
import pytest

PAPER = {
    "paper_id": "abc123",
    "title": "Test Paper",
    "authors": ["Alice"],
    "source": "arXiv",
    "citations": 0,
    "doi": "10.1234/test",
}

PAPER2 = {
    "paper_id": "xyz999",
    "title": "Another Paper",
    "authors": ["Bob"],
    "source": "PubMed",
    "citations": 5,
    "doi": "10.5678/other",
}


async def register_and_token(client) -> str:
    r = await client.post("/api/auth/register", json={"email": "u@test.com", "password": "password123"})
    return r.json()["access_token"]


@pytest.mark.asyncio
async def test_save_and_list_paper(client):
    token = await register_and_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/api/user/saved", json={"paper": PAPER}, headers=headers)
    assert r.status_code == 201
    r2 = await client.get("/api/user/saved", headers=headers)
    assert r2.status_code == 200
    assert len(r2.json()) == 1
    assert r2.json()[0]["paper"]["title"] == "Test Paper"
    assert "paper_id_hash" in r2.json()[0]


@pytest.mark.asyncio
async def test_save_duplicate_returns_409(client):
    token = await register_and_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    await client.post("/api/user/saved", json={"paper": PAPER}, headers=headers)
    r = await client.post("/api/user/saved", json={"paper": PAPER}, headers=headers)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_unsave_paper(client):
    token = await register_and_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    await client.post("/api/user/saved", json={"paper": PAPER}, headers=headers)
    saved = await client.get("/api/user/saved", headers=headers)
    paper_hash = saved.json()[0]["paper_id_hash"]
    r = await client.delete(f"/api/user/saved/{paper_hash}", headers=headers)
    assert r.status_code == 200
    r2 = await client.get("/api/user/saved", headers=headers)
    assert len(r2.json()) == 0


@pytest.mark.asyncio
async def test_unsave_nonexistent_returns_404(client):
    token = await register_and_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.delete("/api/user/saved/nonexistent", headers=headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_and_get_history(client):
    token = await register_and_token(client)
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/api/user/history", json={"paper": PAPER}, headers=headers)
    assert r.status_code == 201
    r2 = await client.get("/api/user/history", headers=headers)
    assert r2.status_code == 200
    assert len(r2.json()) == 1


@pytest.mark.asyncio
async def test_saved_requires_auth(client):
    r = await client.get("/api/user/saved")
    assert r.status_code == 403
```

- [ ] **Step 2: Run and confirm failures**

```bash
cd backend
uv run pytest tests/test_user.py -v
```

Expected: all FAILED (router not defined)

- [ ] **Step 3: Create `backend/routers/user.py`**

```python
import json
import hashlib
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from database import get_db
from models_db import User, SavedPaper, ReadingHistory
from dependencies import get_current_user

router = APIRouter()


class PaperBody(BaseModel):
    paper: dict[str, Any]


def _paper_hash(paper: dict) -> str:
    key = paper.get("doi") or paper.get("paper_id") or paper.get("title") or ""
    return hashlib.sha256(key.strip().lower().encode()).hexdigest()[:32]


@router.get("/saved")
async def get_saved(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SavedPaper)
        .where(SavedPaper.user_id == user.id)
        .order_by(SavedPaper.saved_at.desc())
    )
    return [{"id": row.id, "paper_id_hash": row.paper_id_hash, "paper": json.loads(row.paper_json)}
            for row in result.scalars()]


@router.post("/saved", status_code=201)
async def save_paper(body: PaperBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    h = _paper_hash(body.paper)
    existing = await db.execute(
        select(SavedPaper).where(SavedPaper.user_id == user.id, SavedPaper.paper_id_hash == h)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="已收藏")
    db.add(SavedPaper(user_id=user.id, paper_id_hash=h, paper_json=json.dumps(body.paper)))
    await db.commit()
    return {"saved": True}


@router.delete("/saved/{paper_hash}")
async def unsave_paper(paper_hash: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        delete(SavedPaper).where(SavedPaper.user_id == user.id, SavedPaper.paper_id_hash == paper_hash)
    )
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="未找到")
    return {"deleted": True}


@router.get("/history")
async def get_history(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ReadingHistory)
        .where(ReadingHistory.user_id == user.id)
        .order_by(ReadingHistory.viewed_at.desc())
        .limit(100)
    )
    return [json.loads(row.paper_json) for row in result.scalars()]


@router.post("/history", status_code=201)
async def add_history(body: PaperBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    db.add(ReadingHistory(user_id=user.id, paper_json=json.dumps(body.paper)))
    await db.commit()
    return {"recorded": True}
```

- [ ] **Step 4: Add user router to main.py**

In `backend/main.py`, add:

```python
from routers import user as user_router
app.include_router(user_router.router, prefix="/api/user")
```

- [ ] **Step 5: Run tests and confirm pass**

```bash
cd backend
uv run pytest tests/test_user.py -v
```

Expected: 6 tests PASSED

- [ ] **Step 6: Run all backend tests**

```bash
cd backend
uv run pytest -v
```

Expected: all tests PASSED (including existing download tests)

- [ ] **Step 7: Commit**

```bash
git add backend/routers/user.py backend/tests/test_user.py backend/main.py
git commit -m "feat: add saved papers and reading history endpoints"
```

---

## Task 7: Finalize main.py Wiring + init_db

**Files:** `backend/main.py`

- [ ] **Step 1: Replace main.py with final version**

```python
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import search, auth as auth_router, user as user_router
from database import init_db
from config import CORS_ORIGINS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="ScholarScout API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(search.router, prefix="/api")
app.include_router(auth_router.router, prefix="/api/auth")
app.include_router(user_router.router, prefix="/api/user")
```

- [ ] **Step 2: Run all tests to confirm still passing**

```bash
cd backend
uv run pytest -v
```

Expected: all tests PASSED

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: wire auth/user routers and init DB on startup"
```

---

## Task 8: Frontend — useAuth Hook

**Files:** Create `frontend/src/hooks/useAuth.ts`

- [ ] **Step 1: Create `frontend/src/hooks/useAuth.ts`**

```typescript
import { useState, useCallback } from 'react'

const STORAGE_KEY = 'scholarscout_token'
const USER_KEY = 'scholarscout_user'

export interface AuthUser {
  id: number
  email: string
}

export interface AuthState {
  user: AuthUser | null
  token: string | null
}

async function apiFetch(path: string, body: object): Promise<{ access_token?: string; detail?: string }> {
  const r = await fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.detail || '请求失败')
  return data
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))

  const _persist = useCallback((t: string, u: AuthUser) => {
    localStorage.setItem(STORAGE_KEY, t)
    localStorage.setItem(USER_KEY, JSON.stringify(u))
    setToken(t)
    setUser(u)
  }, [])

  const register = useCallback(async (email: string, password: string) => {
    const data = await apiFetch('/register', { email, password })
    const me = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }).then(r => r.json())
    _persist(data.access_token!, me)
  }, [_persist])

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch('/login', { email, password })
    const me = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }).then(r => r.json())
    _persist(data.access_token!, me)
  }, [_persist])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }, [])

  return { user, token, register, login, logout, isLoggedIn: !!user }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors related to useAuth.ts

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAuth.ts
git commit -m "feat: add useAuth hook"
```

---

## Task 9: Frontend — AuthModal

**Files:** Create `frontend/src/components/AuthModal.tsx`

- [ ] **Step 1: Create `frontend/src/components/AuthModal.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'

interface Props {
  onClose: () => void
}

export function AuthModal({ onClose }: Props) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, register } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (tab === 'login') await login(email, password)
      else await register(email, password)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8">
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-4">
            <button
              className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${tab === 'login' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
              onClick={() => setTab('login')}
            >登录</button>
            <button
              className={`text-sm font-semibold pb-1 border-b-2 transition-colors ${tab === 'register' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400'}`}
              onClick={() => setTab('register')}
            >注册</button>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <input
            ref={inputRef}
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            placeholder={tab === 'register' ? '密码（至少 8 位）' : '密码'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={tab === 'register' ? 8 : 1}
            className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors"
          >
            {loading ? '请稍候…' : tab === 'login' ? '登录' : '注册'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors related to AuthModal.tsx

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AuthModal.tsx
git commit -m "feat: add AuthModal component"
```

---

## Task 10: Frontend — UserMenu

**Files:** Create `frontend/src/components/UserMenu.tsx`

- [ ] **Step 1: Create `frontend/src/components/UserMenu.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { AuthModal } from './AuthModal'

interface Props {
  onNavigate: (page: 'saved' | 'history' | null) => void
}

export function UserMenu({ onNavigate }: Props) {
  const { user, logout, isLoggedIn } = useAuth()
  const [showModal, setShowModal] = useState(false)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!isLoggedIn) {
    return (
      <>
        <button
          onClick={() => setShowModal(true)}
          className="text-sm text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 transition-colors"
        >登录</button>
        {showModal && <AuthModal onClose={() => setShowModal(false)} />}
      </>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center hover:bg-blue-700 transition-colors"
        title={user!.email}
      >
        {user!.email[0].toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-10 bg-white border border-gray-100 rounded-xl shadow-lg w-48 py-1 z-50">
          <div className="px-4 py-2 text-xs text-gray-400 truncate">{user!.email}</div>
          <hr className="my-1 border-gray-100" />
          <button
            onClick={() => { onNavigate('saved'); setOpen(false) }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
          >收藏夹</button>
          <button
            onClick={() => { onNavigate('history'); setOpen(false) }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors"
          >阅读历史</button>
          <hr className="my-1 border-gray-100" />
          <button
            onClick={() => { logout(); setOpen(false); onNavigate(null) }}
            className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
          >退出登录</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/UserMenu.tsx
git commit -m "feat: add UserMenu component"
```

---

## Task 11: PaperCard — Bookmark Button

**Files:** Modify `frontend/src/components/PaperCard.tsx`

- [ ] **Step 1: Read current PaperCard Props interface**

Open `frontend/src/components/PaperCard.tsx` and locate the `Props` interface and the `return (` statement.

- [ ] **Step 2: Add bookmark props to the Props interface**

Find:
```typescript
interface Props {
  paper: Paper
  selected?: boolean
  onToggle?: () => void
  isRejected?: boolean
  onAnalyze?: () => void
  compact?: boolean
}
```

Replace with:
```typescript
interface Props {
  paper: Paper
  selected?: boolean
  onToggle?: () => void
  isRejected?: boolean
  onAnalyze?: () => void
  compact?: boolean
  isSaved?: boolean
  onSave?: () => void
}
```

- [ ] **Step 3: Add bookmark button to the card JSX**

In PaperCard, find the block that renders the "AI 解读" button (near `onAnalyze`). Add a bookmark button **before** it:

```tsx
{onSave && (
  <button
    onClick={e => { e.stopPropagation(); onSave() }}
    title={isSaved ? '取消收藏' : '收藏'}
    className={`p-1.5 rounded-lg transition-colors ${isSaved ? 'text-blue-600 hover:text-blue-800' : 'text-gray-300 hover:text-blue-600'}`}
  >
    <svg className="w-4 h-4" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  </button>
)}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PaperCard.tsx
git commit -m "feat: add bookmark button to PaperCard"
```

---

## Task 12: SavedPage + HistoryPage

**Files:**
- Create: `frontend/src/pages/SavedPage.tsx`
- Create: `frontend/src/pages/HistoryPage.tsx`

- [ ] **Step 1: Create `frontend/src/pages/SavedPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { Paper } from '../types'
import { PaperCard } from '../components/PaperCard'

interface SavedItem {
  id: number
  paper_id_hash: string
  paper: Paper
}

interface Props {
  token: string
  onClose: () => void
}

export function SavedPage({ token, onClose }: Props) {
  const [items, setItems] = useState<SavedItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/user/saved', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((data: SavedItem[]) => { setItems(data); setLoading(false) })
  }, [token])

  const unsave = async (item: SavedItem) => {
    await fetch(`/api/user/saved/${item.paper_id_hash}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setItems(prev => prev.filter(i => i.id !== item.id))
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800">收藏夹</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && <p className="text-center text-gray-400 mt-8">加载中…</p>}
        {!loading && items.length === 0 && (
          <p className="text-center text-gray-400 mt-8">还没有收藏的论文</p>
        )}
        {items.map(item => (
          <PaperCard
            key={item.id}
            paper={item.paper}
            isSaved={true}
            onSave={() => unsave(item)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `frontend/src/pages/HistoryPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { Paper } from '../types'
import { PaperCard } from '../components/PaperCard'

interface Props {
  token: string
  onClose: () => void
}

export function HistoryPage({ token, onClose }: Props) {
  const [papers, setPapers] = useState<Paper[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/user/history', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then((data: Paper[]) => { setPapers(data); setLoading(false) })
  }, [token])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800">阅读历史</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && <p className="text-center text-gray-400 mt-8">加载中…</p>}
        {!loading && papers.length === 0 && (
          <p className="text-center text-gray-400 mt-8">还没有阅读记录</p>
        )}
        {papers.map(p => (
          <PaperCard key={`${p.paper_id}-${Math.random()}`} paper={p} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SavedPage.tsx frontend/src/pages/HistoryPage.tsx
git commit -m "feat: add SavedPage and HistoryPage"
```

---

## Task 13: Wire MainLayout

**Files:** Modify `frontend/src/components/MainLayout.tsx`

- [ ] **Step 1: Add imports at the top of MainLayout.tsx**

After the last existing import line, add:

```typescript
import { useAuth } from '../hooks/useAuth'
import { UserMenu } from './UserMenu'
import { SavedPage } from '../pages/SavedPage'
import { HistoryPage } from '../pages/HistoryPage'
```

- [ ] **Step 2: Add state and auth hook inside MainLayout function**

After `const { model } = useModel()`, add:

```typescript
const { token, isLoggedIn } = useAuth()
const [activePage, setActivePage] = useState<'saved' | 'history' | null>(null)
```

- [ ] **Step 3: Record reading history when paper chat is opened**

Replace the existing `handleAnalyzePaper` function with:

```typescript
const handleAnalyzePaper = (paper: Paper) => {
  setActivePaper(prev => {
    if (prev?.paper_id === paper.paper_id) return null
    if (isLoggedIn && token) {
      fetch('/api/user/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ paper }),
      }).catch(() => {})
    }
    return paper
  })
}
```

- [ ] **Step 4: Add UserMenu to the top bar**

In the MainLayout JSX, find the top bar `div` that contains the site title or the `onClearKey` button. Add `<UserMenu onNavigate={setActivePage} />` next to it.

The exact location depends on current layout — look for the element near `onClearKey`. Add:

```tsx
<div className="flex items-center gap-3">
  <UserMenu onNavigate={setActivePage} />
  {/* existing clear key button here */}
</div>
```

- [ ] **Step 5: Add page overlay for SavedPage / HistoryPage**

Inside the MainLayout return, before the closing tag, add:

```tsx
{activePage === 'saved' && token && (
  <div className="fixed inset-0 z-40 bg-white">
    <SavedPage token={token} onClose={() => setActivePage(null)} />
  </div>
)}
{activePage === 'history' && token && (
  <div className="fixed inset-0 z-40 bg-white">
    <HistoryPage token={token} onClose={() => setActivePage(null)} />
  </div>
)}
```

- [ ] **Step 6: Wire bookmark actions in ResultsPanel → PaperCard**

In `ResultsPanel.tsx`, locate where `<PaperCard>` is rendered. Add `isSaved` and `onSave` props:

```tsx
// At the top of ResultsPanel, add:
import { useAuth } from '../hooks/useAuth'

// Inside the component, after existing state declarations:
const { token, isLoggedIn } = useAuth()
// Map from paper_id -> paper_id_hash (from API), for DELETE requests
const [savedMap, setSavedMap] = useState<Map<string, string>>(new Map())

// Fetch saved state whenever login changes
useEffect(() => {
  if (!isLoggedIn || !token) { setSavedMap(new Map()); return }
  fetch('/api/user/saved', { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.json())
    .then((items: { paper_id_hash: string; paper: { paper_id: string } }[]) => {
      setSavedMap(new Map(items.map(i => [i.paper.paper_id, i.paper_id_hash])))
    })
    .catch(() => {})
}, [isLoggedIn, token])

const handleSave = async (paper: Paper) => {
  if (!token) return
  const existingHash = savedMap.get(paper.paper_id)
  if (existingHash) {
    await fetch(`/api/user/saved/${existingHash}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setSavedMap(prev => { const m = new Map(prev); m.delete(paper.paper_id); return m })
  } else {
    const r = await fetch('/api/user/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ paper }),
    })
    if (r.ok) {
      // Re-fetch to get the server-assigned paper_id_hash
      const saved = await fetch('/api/user/saved', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => res.json()) as { paper_id_hash: string; paper: { paper_id: string } }[]
      setSavedMap(new Map(saved.map(i => [i.paper.paper_id, i.paper_id_hash])))
    }
  }
}

// Then on each <PaperCard>:
// isSaved={savedMap.has(paper.paper_id)}
// onSave={isLoggedIn ? () => handleSave(paper) : undefined}
```

- [ ] **Step 7: Verify full TypeScript build**

```bash
cd frontend
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/MainLayout.tsx frontend/src/components/ResultsPanel.tsx
git commit -m "feat: integrate auth, bookmarks, and page navigation into MainLayout"
```

---

## Task 14: Final Integration Test

- [ ] **Step 1: Run all backend tests**

```bash
cd backend
uv run pytest -v
```

Expected: all tests PASSED

- [ ] **Step 2: Start backend and verify DB is created**

```bash
cd backend
uv run uvicorn main:app --reload &
sleep 3
ls scholarscout.db
curl -s http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpass123"}' | python3 -m json.tool
```

Expected: `scholarscout.db` exists; JSON response with `access_token`

- [ ] **Step 3: Kill backend**

```bash
pkill -f "uvicorn main:app"
```

- [ ] **Step 4: Start frontend dev server and manually verify**

```bash
cd frontend && npm run dev
```

Open browser at `http://localhost:5173`. Verify:
- Top bar shows "登录" button
- Click "登录" → AuthModal appears
- Register with a test email → modal closes, avatar appears
- Search for papers → bookmark icon appears on cards
- Click bookmark → icon turns blue
- Open UserMenu → click "收藏夹" → SavedPage shows the paper
- Click "阅读历史" → HistoryPage shows papers opened for AI chat
- Logout → back to "登录" button, saved state cleared

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Phase 1 complete — auth, collections, reading history"
```
