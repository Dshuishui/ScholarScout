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

**Live demo**: [http://118.25.192.117](http://118.25.192.117) (requires your own DeepSeek API Key)

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
- **CSV export**: Export full results with title, authors, abstract, and links

### AI Conversations
- **Per-paper AI chat**: Each paper card has an "AI Chat" button that opens a right-side drawer for deep discussion (methods, contributions, limitations, etc.); each paper has its own independent conversation context
- **Full-text analysis via PDF**: Upload the paper's PDF in the chat drawer and AI switches to full-text mode — context window handles entire papers (up to DeepSeek V4's 1M token limit)
- **PDF state persistence**: Uploaded PDFs survive page refreshes and are restored automatically
- **Markdown rendering**: AI responses render tables, code blocks, and formatted text
- **Stop button**: Interrupt streaming at any time, keeping the content generated so far
- **Copy button**: Hover any AI message to copy it
- **Configurable quick prompts**: Pre-set questions in the chat drawer are fully editable and saved locally
- **Multi-paper AI analysis**: Select 2+ papers to trigger a full-screen analysis panel with three modes:
  - **Comparative analysis** — side-by-side comparison with summary table
  - **Literature review** — synthesis paragraph with inline citations
  - **Research trends** — temporal trend analysis

### Account & Collections
- **Optional registration**: Email sign-up/login; all search features work without an account
- **Bookmarks**: Save papers with the bookmark icon; view and manage in the Bookmarks page
- **Chat history**: Every paper you open an AI conversation for is automatically logged; view the last 100 in History

### Subscriptions & Email Push
- **Keyword subscriptions**: Subscribe to a keyword set and receive daily emails (08:00 CST) with new papers since the last send
- **Subscription management**: Toggle, delete, or test-send from the Subscriptions page
- **Subscribe button**: Appears next to the keyword chips after a search

---

## How It Works

![Architecture](docs/images/Architecture.png)

---

## Usage

ScholarScout requires your own **DeepSeek API Key** to power AI features (the key is stored only in your browser and never sent to our server).

**Step 1 — Get a DeepSeek API Key**

1. Sign up at [platform.deepseek.com](https://platform.deepseek.com)
2. Create an API Key (format: `sk-xxxxxxxx`)
3. DeepSeek pricing is very low; typical usage costs are negligible

**Step 2 — Start searching**

Visit [118.25.192.117](http://118.25.192.117), paste your API Key, and describe the papers you're looking for.

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

Go to [http://localhost:5173](http://localhost:5173) and enter your DeepSeek API Key.

---

## Optional Data Source API Keys

ScholarScout works out of the box with 7 sources that require no registration. The following sources need a free API Key:

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

### Server config

```bash
sudo mkdir -p /etc/scholarscout
sudo nano /etc/scholarscout/env
# Add keys and save
sudo systemctl restart scholarscout-backend
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

**Completed**: Account system, bookmarks, chat history, subscriptions with daily email push, multi-paper AI analysis, full-text PDF chat.

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
