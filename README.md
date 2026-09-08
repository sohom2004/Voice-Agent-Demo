# Natasha Voice Agent

Natasha is a multilingual voice assistant with document grounding and live database access via **sql-mcp**, a **FastAPI** backend, and **LiveKit** for real-time voice.

## Architecture

```
React Frontend (Vite)  →  FastAPI Backend  →  PostgreSQL / SQLite (documents/RAG)
                              ↓                        ↑
                         sql-mcp (fast-path)     doc-retrieval (fast-path RAG)
                              ↓
                    SQLite / Postgres tenant DB

LiveKit Room  ↔  LiveKit Voice Agent (Python)  ↔  sql-mcp fast-path tools
                                                ↔  doc-retrieval search tool
```

Database access and document RAG are two **independent** tools, both compiled/cached
once at startup rather than discovered per turn — see "Fast path" below.

## Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL (for document storage)
- LiveKit Cloud or self-hosted LiveKit server
- Gemini API key

## Setup

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Install frontend dependencies:

```bash
npm install
```

3. Install Python dependencies:

```bash
pip3 install -r backend/requirements.txt
pip3 install -e sql-mcp
pip3 install -e doc-retrieval
pip3 install -r voice-agent/requirements.txt
```

4. Start the stack:

```bash
# Terminal 1 — API + frontend
npm run dev

# Terminal 2 — LiveKit voice agent worker
npm run dev:voice-agent
```

- Frontend: http://localhost:3000
- FastAPI: http://localhost:8000
- API docs: http://localhost:8000/docs

### Document ingestion

Uploaded documents are processed automatically by a **Python background worker** inside the FastAPI backend:

1. Poll for documents with `uploaded` status
2. Parse (txt, md, pdf, docx, xlsx, csv)
3. Chunk with section-aware splitting
4. Generate Gemini embeddings (`gemini-embedding-2`)
5. Index chunks into the platform database (PostgreSQL or SQLite fallback)
6. Mark document as `ready`

The legacy Node ingestion worker (`npm run ingestion-worker`) is no longer started by the backend.

Retrieval itself is a **separate, dedicated tool** (`doc-retrieval`, its own
package — see "Fast path" below) rather than context bolted onto every chat
turn, so a database-only question no longer pays for an embedding call.

### Fast path (low-latency tool selection)

Both the FastAPI text chat and the LiveKit voice agent share the same design:
schema/documents are introspected **once at startup**, compiled into a small,
fixed set of tools, and handed to the model — no runtime discovery, no
freeform SQL generation for common lookups. This is what makes tool
selection a single, decisive call instead of a multi-turn round trip.

**`sql-mcp`** compiles the connected schema into deterministic per-table tools:

- `get_<table>_by_id`, `list_<table>`, `count_<table>` — reads
- `create_<table>`, `update_<table>_by_id`, `delete_<table>_by_id` — writes,
  gated behind an explicit `confirmed=true` the model only sets after the
  user has actually confirmed out loud
- `run_custom_read_query` — last-resort read-only SQL for analytics/joins a
  specific tool can't express

The manifest is cached by schema hash (`SqlMcpEngine.compile_manifest()`) and
only recompiles when the schema actually changes.

**`doc-retrieval`** is a standalone package (no dependency on sql-mcp) that
exposes one tool, `search_documents`. It reads the same chunk store the
ingestion worker writes to, keeps a short-TTL in-memory cache per workspace
so repeated questions in a conversation don't re-hit the DB, and degrades to
a local keyword-overlap ranking (instead of failing) if no Gemini API key or
embeddings are available yet.

Used by:

- FastAPI `/api/chat` (text chat with tool calling — both tool families)
- FastAPI `/api/sql-mcp/*` (dashboard + debug; the "Compiled Tools" panel
  reflects the live manifest)
- LiveKit voice agent (function tools — both tool families)

Run sql-mcp as a standalone MCP stdio server:

```bash
python3 -m sql_mcp.server
```

## LiveKit Voice

1. Configure `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in `.env`
2. Start the voice agent worker: `npm run dev:voice-agent`
3. Click the live call button in the UI to join a LiveKit room

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `POST /api/chat` | Text chat with sql-mcp tools |
| `POST /api/livekit/token` | LiveKit room token |
| `GET /api/sql-mcp/column-context` | Schema inspector data |
| `POST /api/sql-mcp/call-tool` | Direct tool invocation |
| `GET/POST /api/documents/*` | Document upload & RAG |

## What Changed (v3)

- Restored the compiled-manifest fast path from the original `db-agent`
  (commit `55632b8`) inside `sql-mcp`: the LiveKit agent and `/api/chat` no
  longer discover schema or hand-write SQL per turn, cutting a 2-4 round
  trip tool loop down to one decisive call per question
- Added `doc-retrieval`, a standalone RAG tool independent of sql-mcp, with
  its own in-memory cache and a graceful keyword-fallback ranking
- The LiveKit voice agent now has document search at all — it previously had
  no way to answer questions about uploaded files
- `/api/chat` no longer unconditionally fetches + embeds against document
  context on every message; `search_documents` is now a tool the model
  calls only when a question is actually about uploaded documents
- Removed dead code: `backend/app/services/retrieval.py` referenced a
  `context_plan` module that didn't exist anywhere in the Python backend
- Fixed an import path bug in `backend/app/services/sql_mcp.py` that meant
  its `sys.path` fallback for `sql-mcp` never actually pointed at the repo
  root (it only worked because `pip install -e sql-mcp` was documented as
  a setup step)

## What Changed (v2)

- Removed `database-intelligence` NL2SQL layer
- Replaced Express monolith with FastAPI backend
- Replaced Gemini Live WebSocket with LiveKit voice agent
- Unified database access through sql-mcp
