# ScholarScout

> Natural language paper search, AI relevance filtering, vector-based semantic retrieval.

[中文](README.md) | English

[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white)](https://www.python.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![CI](https://github.com/Dshuishui/ScholarScout/actions/workflows/ci.yml/badge.svg)](https://github.com/Dshuishui/ScholarScout/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![uv](https://img.shields.io/badge/package_manager-uv-8A2BE2?logo=python)](https://github.com/astral-sh/uv)

ScholarScout is a full-stack academic paper search platform. Describe what you're looking for in plain language; the backend concurrently queries 10 academic databases, runs LLM-based relevance validation, and streams results back via SSE. Paper abstracts are asynchronously embedded into a local vector store, enabling semantic retrieval, multi-paper RAG Q&A, and similarity graph visualisation.

**Live demo**: [http://118.25.192.117](http://118.25.192.117)

> Sign up and verify your email to get **3 free searches** — no API key required. Add your own DeepSeek API key for unlimited access.

---

## Screenshots

### Search Results
![Search Results](docs/images/02_search_results.png)

### AI Paper Chat
> Each paper has its own isolated conversation context; PDF full-text upload supported

![AI Paper Chat](docs/images/03_ai_chat_drawer.png)

---

## Features

### Search & Discovery
- **Natural language queries**: "Find papers on LLM hallucination after 2023" — no Boolean syntax needed
- **Editable keyword chips**: AI extracts keywords before searching; edit or remove them, then re-search at any time
- **10-source concurrent search**: arXiv, Semantic Scholar, OpenAlex, PubMed, Europe PMC, INSPIRE-HEP, CORE, NASA ADS, CrossRef, Google Scholar — all in parallel
- **Smart deduplication**: DOI exact match + normalised title comparison; duplicates are merged, preserving the best fields (PDF, abstract, citations)
- **AI relevance filtering**: LLM second-pass validation; toggle between "AI filtered" and "all results"

### PDF Access
- **Deep PDF search**: Papers without a PDF link are automatically searched via Kimi for open-access versions
- **Fallback links**: If no PDF is found, 8 platform links are shown (Sci-Hub, ResearchGate, CORE, etc.)
- **Batch ZIP download**: Select papers and download all available PDFs in one click; failures are logged inside the archive

### AI Analysis
- **Multi-paper analysis**: Select 2+ papers for full-screen AI analysis in three modes:
  - **Comparative**: Summary table + method, contribution, and result comparison
  - **Literature review**: Formal academic prose, ready to use as a Related Work draft
  - **Research trends**: Chronological technique evolution with future direction predictions
- **Per-paper AI chat**: Each card has its own conversation drawer with isolated context
- **PDF full-text mode**: Upload a PDF to switch to full-text analysis (DeepSeek V4, 1M-token context)
- **Cloud PDF persistence**: Uploaded full text is stored server-side and restored automatically on re-login

### Semantic Retrieval & RAG
- **Vector semantic search**: Search results are asynchronously embedded into ChromaDB using ONNX MiniLM L6 v2 (local inference, no external API key). Natural language queries match papers by meaning, not just keywords.
- **Multi-paper RAG Q&A**: Select papers and ask questions; abstracts are injected as context into DeepSeek streaming, with citation markers `[1][2]` in the response
- **Real-time indexing notification**: WebSocket push notifies the UI when background vector indexing completes

### Similarity Graph
- **Pairwise cosine graph**: Backend computes cosine similarity across all selected papers' embeddings and returns `{nodes, links}`
- **Force-directed visualisation**: `react-force-graph-2d` renders the graph — node size = log(citations), edge width = similarity score
- **Adjustable threshold**: Slider in the header filters edges below the chosen similarity value in real time

### Subscriptions & Daily Push
- **Keyword subscriptions**: Subscribe after any search; the system immediately builds a push queue in the background
- **Daily email**: Delivers one curated paper to your inbox at 08:00 CST; AI filtering ensures relevance
- **Auto-replenishment**: Queue is refilled automatically when fewer than 5 papers remain; manual refresh also available
- **Queue visibility**: Subscription management page shows the full queue (✅ sent with date / 📅 scheduled with date)

### Accounts & Auth
- **Email registration + verification**: JWT authentication; registration and login endpoints are rate-limited
- **Atomic free-quota deduction**: `WHERE free_searches > 0` row-level lock prevents concurrent over-spend
- **Saved papers / reading history / search sessions**: Synced across devices after login

### Real-time WebSocket Push
- Persistent WebSocket connection between frontend and backend; optional JWT auth; ping/pong keepalive
- Background events (vector index done, subscription queue ready) pushed as toast notifications
- Connection status indicator (green/amber/grey dot); exponential-backoff auto-reconnect

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | React 19 + TypeScript + Vite + Tailwind CSS v4 | |
| **Graph viz** | react-force-graph-2d | D3 force-directed, Canvas renderer |
| **Backend** | Python 3.11 + FastAPI | Async-first |
| **Real-time** | SSE (search progress) + WebSocket (background events) | Dual channel |
| **Database** | SQLAlchemy async + Alembic migrations | SQLite (dev) / PostgreSQL (prod) |
| **Vector DB** | ChromaDB + ONNX MiniLM L6 v2 | Local inference, no external API |
| **Cache** | Redis (optional) | Search result cache, 1h TTL, graceful no-op fallback |
| **AI** | DeepSeek API (OpenAI-compatible) | Intent parsing, validation, RAG |
| **Logging** | structlog | JSON or coloured console, runtime-switchable |
| **Error tracking** | Sentry SDK | FastAPI + SQLAlchemy integrations; disabled when no DSN |
| **Testing** | pytest + httpx AsyncClient | Async integration tests; rate-limit fixture isolation |
| **CI/CD** | GitHub Actions | lint → test → build; uv cache for fast installs |
| **Package mgmt** | uv (backend) / npm (frontend) | |

---

## Engineering Notes

> Non-obvious decisions worth calling out for technical readers.

1. **Non-blocking vector indexing**: After yielding the final SSE `done` event, `asyncio.create_task` fires off ChromaDB writes in a dedicated `ThreadPoolExecutor`. The HTTP response is never held waiting.

2. **Zero-downtime Alembic bootstrap**: On startup, `init_db()` inspects whether `alembic_version` exists. Pre-Alembic databases are `stamp head`-ed rather than migrated, preventing false "empty schema" detection.

3. **WebSocket connection grouping**: `ConnectionManager` groups sockets by `user:{id}` or `anon:{cid}`. Multiple tabs for the same user all receive notifications. Dead connections are lazily pruned on the next send attempt — no background sweeper needed.

4. **Redis zero-friction fallback**: `cache_service.py` lazily initialises the Redis client at module level. When `REDIS_URL` is unset, every `get/set` returns early — no try/except required in calling code.

5. **Dialect-aware connection pooling**: `pool_size`, `max_overflow`, and `pool_pre_ping` are only passed to `create_async_engine` for non-SQLite engines, avoiding `ProgrammingError` in dev.

6. **Conditional `render_as_batch`**: SQLite requires Alembic batch mode for `ALTER COLUMN`; PostgreSQL does not. `env.py` detects the dialect at migration time so one migration file serves both databases.

7. **Atomic free-quota deduction**: `UPDATE users SET free_searches = free_searches - 1 WHERE id = ? AND free_searches > 0` — row-level locking prevents concurrent over-spend; `rowcount == 0` fast-fails without application-level locks.

8. **SSE + concurrent source progress**: Each data source signals completion via an `asyncio.Queue`. The main generator non-blockingly drains the queue while awaiting the search task, yielding `source_done` events so the frontend progress bar updates per source in real time.

9. **structlog dual-mode rendering**: `LOG_FORMAT=console` → coloured key=value for development; `json` → structured JSON lines for Loki/Datadog in production. One `get_logger()` call everywhere; renderer selected at startup.

10. **WebSocket exponential backoff**: `useWebSocket` hook doubles the retry delay on each `onclose` (capped at 30 s) and resets to 1 s on successful reconnect. A 25 s ping interval prevents Nginx idle-timeout disconnection.

---

## Quick Start

### Online Demo

Visit [118.25.192.117](http://118.25.192.117), register, verify your email, and use 3 free searches immediately.

**Example queries**

```
Find survey papers on RAG (retrieval-augmented generation) after 2023
Diffusion models for medical image segmentation, last two years
Reinforcement learning for robot control, top-venue papers only
```

> Default time window is the last 5 years when no date is specified.

---

## Local Development

**Prerequisites**: Python 3.11+, [uv](https://github.com/astral-sh/uv), Node.js 18+

```bash
git clone https://github.com/Dshuishui/ScholarScout.git
cd ScholarScout

# Backend
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and enter your DeepSeek API key.

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env`. All variables have sensible defaults — the app starts without any of them configured.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./scholarscout.db` | Set to `postgresql+asyncpg://...` for production |
| `REDIS_URL` | _(empty, disabled)_ | e.g. `redis://localhost:6379/0` |
| `CACHE_SEARCH_TTL` | `3600` | Search result cache TTL in seconds |
| `SENTRY_DSN` | _(empty, disabled)_ | Sentry project DSN |
| `SENTRY_ENVIRONMENT` | `development` | `production` / `staging` |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Performance tracing sample rate |
| `LOG_FORMAT` | `console` | `json` for structured log lines |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `WARNING` |
| `CORE_API_KEY` | _(empty)_ | Free: [core.ac.uk](https://core.ac.uk/services/api) |
| `NASA_ADS_API_KEY` | _(empty)_ | Free: [ads.harvard.edu](https://ui.adsabs.harvard.edu/user/settings/token) |
| `JWT_SECRET` | `dev-secret-change-in-production` | **Must be changed in production** |
| `DEEPSEEK_SYSTEM_KEY` | _(empty)_ | Server-side key for free-trial searches |
| `SMTP_HOST / SMTP_USER / SMTP_PASS` | _(empty)_ | Email delivery configuration |

---

## Data Sources

| Source | Coverage | Key required |
|--------|---------|--------------|
| **arXiv** | CS / Physics / Math / Economics, latest preprints | No |
| **Semantic Scholar** | General, strong semantic search | No (key raises rate limit) |
| **OpenAlex** | General, 200M+ papers, OA-friendly | No |
| **PubMed** | Medicine / Biology / Life sciences | No |
| **Europe PMC** | Life sciences / Medicine, incl. bioRxiv / medRxiv | No |
| **INSPIRE-HEP** | High energy physics / Particle physics (CERN) | No |
| **CrossRef** | General, 150M+ metadata records, incl. humanities | No |
| **CORE** | 170M+ open-access full texts | Yes (free) |
| **NASA ADS** | Astronomy / Astrophysics / Earth sciences | Yes (free) |
| **Google Scholar** | General, broadest coverage | Yes (free quota) |

**Unpaywall** automatically supplements DOI-bearing papers with legal open-access PDF links (no key required).

---

## Deployment

```bash
git clone https://github.com/Dshuishui/ScholarScout.git
cd ScholarScout
bash deploy/setup.sh    # first deployment

bash deploy/deploy.sh   # subsequent updates
```

**Requirements**: Ubuntu 22.04+, 4 CPU cores / 4 GB RAM, outbound internet access.

---

## Project Status

**Completed**

- Full search pipeline: natural language → keyword extraction → 10-source concurrent → LLM validation → SSE streaming
- Vector semantic retrieval: ChromaDB + ONNX local embeddings, no external API
- Multi-paper RAG Q&A: DeepSeek streaming with citation markers
- Similarity graph: pairwise cosine + react-force-graph-2d visualisation
- WebSocket real-time push notifications for background task completion
- PostgreSQL / Redis production-ready (env-driven, SQLite fallback)
- Alembic migrations with dialect-aware `render_as_batch`
- structlog structured logging + Sentry error tracking (both gracefully disabled when unconfigured)
- GitHub Actions CI (lint + test + build)
- Keyword subscriptions + daily email push queue (APScheduler)
- Multi-paper AI analysis (compare / review / trends; results independently cached)
- PDF full-text chat with cloud persistence
- Email registration / JWT auth / atomic free-quota deduction
- Mobile-responsive layout

**Planned**

- Additional model support (Claude, GPT-4o)
- User statistics dashboard
- Chinese academic database integration

---

## Acknowledgements

- [DeepSeek](https://www.deepseek.com) — AI inference
- [ChromaDB](https://www.trychroma.com) — local vector database
- [arXiv](https://arxiv.org), [Semantic Scholar](https://www.semanticscholar.org), [OpenAlex](https://openalex.org), [PubMed](https://pubmed.ncbi.nlm.nih.gov), [Europe PMC](https://europepmc.org), [INSPIRE-HEP](https://inspirehep.net), [CORE](https://core.ac.uk), [NASA ADS](https://ui.adsabs.harvard.edu), [CrossRef](https://www.crossref.org) — open academic data APIs
- [Unpaywall](https://unpaywall.org) — open-access PDF lookup
- [astral-sh/uv](https://github.com/astral-sh/uv) — fast Python package management

---

## License

MIT © [Dshuishui](https://github.com/Dshuishui)
