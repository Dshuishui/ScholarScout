# ScholarScout

> Find academic papers in plain language — no technical knowledge required.

[中文](README.md) | English

[![Python](https://img.shields.io/badge/Python-3.11+-blue?logo=python&logoColor=white)](https://www.python.org)
[![uv](https://img.shields.io/badge/package_manager-uv-purple?logo=python)](https://github.com/astral-sh/uv)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![CI](https://github.com/Dshuishui/ScholarScout/actions/workflows/ci.yml/badge.svg)](https://github.com/Dshuishui/ScholarScout/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![Made with Claude](https://img.shields.io/badge/Made%20with-Claude-orange?logo=anthropic)](https://claude.ai)

ScholarScout is an academic paper search tool built for non-CS researchers. Describe what you're looking for in natural language, and it automatically interprets your intent, searches across 10 databases simultaneously, filters results with AI, and returns a list of real, relevant papers — with one-click PDF preview and download.

**Subscribe to a keyword set and the system pre-fetches papers, builds a push queue, and delivers one curated paper to your inbox every morning at 08:00 — no daily check-ins needed.**

**Live demo**: [http://118.25.192.117](http://118.25.192.117)

> ⚡ **Sign up and verify your email to get 3 free searches** — no API key needed. You can also use your own DeepSeek API key for unlimited access.

---

## Screenshots

### AI Paper Chat (core feature)
> Click "AI Chat" on any paper card to open a dedicated conversation drawer — each paper has its own context

![AI Paper Chat Drawer](docs/images/03_ai_chat_drawer.png)

### Search Results
![Search Results](docs/images/02_search_results.png)

---

## Features

### Search & Discovery
- **Natural language search**: Just say "find papers on LLM hallucination after 2023" — no manual keyword crafting needed
- **Editable keyword chips**: AI extracts keywords and displays them before searching; you can add, remove, or edit them and re-search any time
- **Search history**: Last 10 searches auto-saved, one click to reuse
- **10-source selection**: Toggle any of 10 data sources from the header; mix and match by research domain
- **10-source concurrent search**: Simultaneously queries arXiv, Semantic Scholar, OpenAlex, PubMed, Europe PMC, INSPIRE-HEP, CORE, NASA ADS, CrossRef, and Google Scholar
- **Smart deduplication**: DOI exact match + normalized title comparison; duplicates are merged, keeping the best fields (PDF, abstract, citation count)
- **Multi-source badges**: Papers found in multiple sources show all source buttons on the card

### Results Display
- **AI relevance filtering**: Results are validated by LLM; switch between "AI filtered" and "all results" tabs; filtered-out papers are still accessible
- **List / grouped view**: Group by source to quickly see which databases returned what
- **Venue labels**: Journal/conference name extracted per paper, shown next to authors for quick quality assessment
- **Sorting**: Relevance / most cited / newest / oldest
- **Configurable limits**: Adjust per-source fetch count (up to 200) and display limit (up to 500) directly in the UI

### PDF & Downloads
- **PDF deep search**: After search, automatically scans for open-access PDFs for papers without one; falls back to links for Sci-Hub, ResearchGate, CORE, and 5 other platforms
- **Bulk download**: Select papers and download all PDFs as a ZIP; failed downloads are logged in the archive
- **CSV export**: Two modes — export only AI-filtered papers (default) or export everything; live count shown in the dialog

### AI Conversations
- **Per-paper AI chat**: Each paper card has an "AI Chat" button that opens a right-side drawer for deep discussion (methods, contributions, limitations, etc.); each paper has its own independent conversation context
- **Full-text analysis via PDF**: Upload the paper's PDF in the chat drawer and AI switches to full-text mode — supports DeepSeek V4's 1M token context window, covering papers of any length
- **Cloud PDF persistence**: Uploaded PDF text is saved server-side and tied to your account — just like Claude.ai, it's automatically restored after page refresh or when logging in from another device; no re-uploading needed
- **Markdown rendering**: AI responses render tables, code blocks, and formatted text
- **Stop button**: Interrupt streaming at any time, keeping the content generated so far
- **Copy button**: Hover any AI message to copy it
- **Configurable quick prompts**: Pre-set questions in the chat drawer are fully editable and saved locally
- **Multi-paper AI analysis**: Select 2+ papers to trigger a full-screen analysis panel with three modes:
  - **Comparative analysis** — side-by-side comparison with summary table
  - **Literature review** — synthesis paragraph with inline citations
  - **Research trends** — temporal trend analysis

### Account & Access
- **Email registration + verification**: Sign up, receive a verification email, click the link to activate
- **Free trial**: Verified new users get **3 free searches** powered by the system — no API key needed to experience all features
- **Unlimited with your own key**: Enter your DeepSeek API key to remove all usage limits
- **Bookmarks**: Save papers with the bookmark icon; view and manage in the Bookmarks page
- **Chat history**: Every paper you open an AI conversation for is automatically logged; view the last 100 in History
- **Security**: Registration rate-limiting (5/hr/IP), login failure throttling (10/15min/IP), 256-bit verification tokens, system key server-side only

### 📬 Keyword Subscriptions & Daily Push (Flagship Feature)

No need to check back every day — subscribe once and let papers come to you.

- **One-click subscribe**: After a search, click "Subscribe" next to the keyword chips. A confirmation modal shows the subscribed keywords, push schedule (daily 08:00 CST), and receiving email address
- **Smart push queue**: On subscription, the system immediately searches for relevant papers in the background, builds a queue, and schedules them day by day. Each morning it picks the next paper in line and sends it — no duplicates, no gaps
- **Configurable daily volume**: Defaults to 1 paper per day (great for deep reading). Adjustable to 1–10 papers/day in the Subscriptions page
- **Push progress visible**: Expand any subscription card to see the full queue — ✅ sent (with date) / 📅 pending (with planned date) — so you always know what's coming next
- **Auto-refill**: When fewer than 5 papers remain in the queue, the system automatically searches for new papers and appends them; you can also manually trigger a refresh
- **AI-filtered queue**: Only papers that pass AI relevance validation enter the queue — no off-topic results
- **Subscription management**: Toggle or delete anytime; up to 20 active keyword sets

---

## How It Works

![Architecture](docs/images/Architecture.png)

---

## Usage

### Option 1 — Free trial (recommended for new users)

1. Visit [118.25.192.117](http://118.25.192.117)
2. Click **"Sign up for free"**, enter your email and password
3. Check your inbox and click the verification link
4. You're automatically logged in with **3 free searches** — start exploring

### Option 2 — Your own API key (unlimited)

1. Sign up at [platform.deepseek.com](https://platform.deepseek.com) and create an API key (`sk-xxxxxxxx`)
2. Visit [118.25.192.117](http://118.25.192.117), paste your key in the input field, and start searching

> DeepSeek pricing is very low; typical usage costs are negligible.

> **Note**: The demo is hosted on a personal cloud server, expected to stay up until **early 2027**. It's a side project with no uptime guarantees — for anything important, consider self-hosting.

**Example queries**

```
Find survey papers on RAG (retrieval-augmented generation) after 2023
Diffusion models for medical image segmentation, recent two years
Reinforcement learning for robot control, top-venue publications only
```

> **Time range**: When no date is specified, the search defaults to the **last 5 years**. To search older literature, explicitly state a range, e.g. "papers from 2015 onwards" or "no date restriction".

---

## Local Setup

Run ScholarScout on your own machine — no server, no Nginx needed.

**Requirements**: Python 3.11+, [uv](https://github.com/astral-sh/uv), Node.js 18+, npm

**1. Install uv**

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**2. Clone the repo**

```bash
git clone https://github.com/Dshuishui/ScholarScout.git
cd ScholarScout
```

**3. Start the backend** (new terminal)

```bash
cd backend
uv sync          # creates virtualenv and installs dependencies
uv run uvicorn main:app --reload --port 8000
```

When you see `Uvicorn running on http://127.0.0.1:8000`, the backend is ready.

**4. Start the frontend** (another terminal)

```bash
cd frontend
npm install
npm run dev
```

When you see `Local: http://localhost:5173`, the frontend is ready.

**5. Open in browser**

Go to [http://localhost:5173](http://localhost:5173) and enter your DeepSeek API key.

---

## Optional Data Source API Keys

ScholarScout works out of the box with 7 sources that require no registration. The following sources need a free API key:

| Source | Coverage | Get Key |
|--------|----------|---------|
| **CORE** | 170M+ open-access papers | [core.ac.uk/services/api](https://core.ac.uk/services/api) |
| **NASA ADS** | Astronomy / astrophysics / earth science | [ui.adsabs.harvard.edu/user/settings/token](https://ui.adsabs.harvard.edu/user/settings/token) |
| **Semantic Scholar** | General, strong semantic search | [semanticscholar.org/product/api](https://www.semanticscholar.org/product/api) |

All are completely free. **Sources without a key are silently skipped; everything else still works.**

### Local config

```bash
cd backend
cp .env.example .env
# Edit .env and fill in the keys you have
```

---

## Server Deployment

```bash
git clone https://github.com/Dshuishui/ScholarScout.git
cd ScholarScout
bash deploy/setup.sh   # first-time setup
```

Subsequent updates:

```bash
bash deploy/deploy.sh
```

**Requirements**: Ubuntu 22.04+, 4 CPU cores / 4 GB RAM, outbound internet access.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Backend | Python 3.11 + FastAPI + SSE streaming + SQLite |
| Package management | [uv](https://github.com/astral-sh/uv) (backend) / npm (frontend) |
| AI | DeepSeek API (intent parsing, keyword extraction, relevance filtering) |
| Search sources | 10 academic databases + Unpaywall PDF lookup |
| Deployment | Nginx + systemd, GitHub Actions CI |

---

## Search Sources

| Source | Strengths | Key Required |
|--------|-----------|-------------|
| **arXiv** | CS / Physics / Math / Economics, latest preprints | No |
| **Semantic Scholar** | General, strong semantic search | No (key improves rate limits) |
| **OpenAlex** | General, 200M+ papers, OA-friendly | No |
| **PubMed** | Medicine / Biology / Life sciences | No |
| **Europe PMC** | Life science / Biochem / Medicine, incl. bioRxiv / medRxiv | No |
| **INSPIRE-HEP** | High-energy physics / Particle physics / Theoretical physics (CERN) | No |
| **CrossRef** | General, 150M+ metadata records, incl. humanities / engineering | No |
| **CORE** | 170M+ open-access full texts | Yes (free) |
| **NASA ADS** | Astronomy / Astrophysics / Earth science | Yes (free) |
| **Google Scholar** | General, broadest coverage | Yes (free tier) |

After search, **Unpaywall** automatically finds legal open-access PDFs for papers with a DOI (no key needed).

> **Note on non-English papers**: Current data sources are primarily English-language academic databases. Support for Chinese-language papers is limited — CNKI, Wanfang, and similar platforms require institutional API access that isn't currently integrated.

---

## Project Status

🚧 **Actively developed** — early stage.

**Completed**:
- Account system: email sign-up / verification / login, JWT auth, auto-logout on expiry
- Free trial: verified new users get 3 free searches (system-funded, atomic decrement to prevent abuse)
- Bookmarks and reading history
- **Keyword subscriptions with daily push queue**: AI-filtered papers pre-scheduled into a per-day queue; sends at 08:00 CST; configurable volume (1–10/day); Subscriptions page shows full push progress (sent/pending with dates); auto-refills when queue runs low
- Multi-paper AI analysis (compare / literature review / trends)
- Full-text PDF chat with server-side persistence (no re-upload across sessions and devices)
- CSV export with AI-filtered-only option
- Mobile-responsive layout (bottom tab bar + bottom sheet drawer)
- Bundle code splitting: initial gzip 126 KB (−29%)

**Planned**: More model support (Claude, GPT), user stats dashboard, mobile-optimized landing page.

Most of this codebase was written with **AI assistance (Claude)**. It's a hobby project, not a production system. If you find a bug or have an idea, feel free to open a [GitHub Issue](https://github.com/Dshuishui/ScholarScout/issues) — all feedback welcome 🙏

---

## Acknowledgments

- [DeepSeek](https://www.deepseek.com) — AI inference
- [arXiv](https://arxiv.org), [Semantic Scholar](https://www.semanticscholar.org), [OpenAlex](https://openalex.org), [PubMed](https://pubmed.ncbi.nlm.nih.gov), [Europe PMC](https://europepmc.org), [INSPIRE-HEP](https://inspirehep.net), [CORE](https://core.ac.uk), [NASA ADS](https://ui.adsabs.harvard.edu), [CrossRef](https://www.crossref.org) — free open academic data APIs
- [Unpaywall](https://unpaywall.org) — open-access PDF lookup
- [astral-sh/uv](https://github.com/astral-sh/uv) — blazing-fast Python package manager

---

## License

MIT © [Dshuishui](https://github.com/Dshuishui)
