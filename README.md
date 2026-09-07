# Natasha Voice Agent

Natasha is a multilingual voice assistant with document grounding and live database access via **sql-mcp**, a **FastAPI** backend, and **LiveKit** for real-time voice.

## Architecture

```
React Frontend (Vite)  →  FastAPI Backend  →  PostgreSQL (documents/RAG)
                              ↓
                         sql-mcp (reads/writes)
                              ↓
                    SQLite / Postgres tenant DB

LiveKit Room  ↔  LiveKit Voice Agent (Python)  ↔  sql-mcp tools
```

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

The `sql-mcp` package exposes safe database tools:

- `list_tables` — list user tables
- `describe_table` — column metadata
- `execute_read` — parameterized SELECT queries
- `execute_write` — INSERT/UPDATE/DELETE (requires confirmation)

Used by:

- FastAPI `/api/chat` (text chat with tool calling)
- FastAPI `/api/sql-mcp/*` (dashboard + debug)
- LiveKit voice agent (function tools)

Run as standalone MCP stdio server:

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

## What Changed (v2)

- Removed `database-intelligence` NL2SQL layer
- Replaced Express monolith with FastAPI backend
- Replaced Gemini Live WebSocket with LiveKit voice agent
- Unified database access through sql-mcp
