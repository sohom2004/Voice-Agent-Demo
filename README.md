# Natasha Medical Billing BPO Voice Agent

Natasha is a professional **medical billing BPO customer-service voice agent** demo.
It helps callers with billing accounts, claims, invoices, payments, and support tickets
using **LiveKit + Gemini Live** for low-latency voice, **sql-mcp** for compiled database
tools, and **doc-retrieval** for policy document grounding.

## Architecture

```
React Frontend (Vite)  →  FastAPI Backend  →  PostgreSQL
                              │                    │
                              │                    ├─ public: documents, document_chunks (RAG)
                              │                    └─ business: customers, claims, invoices, …
                              ▼
                         sql-mcp (fast-path)     doc-retrieval (fast-path RAG)

LiveKit Room  ↔  LiveKit Voice Agent (Python)  ↔  sql-mcp PostgreSQL tools
                                                ↔  ticket workflow tools
                                                ↔  doc-retrieval search tool
```

Development and production share one SQL-MCP implementation. The connection is
configured with `DATABASE_URL` (local PostgreSQL or Render's **internal** Postgres URL).

`demo_database.db` is the original SQLite demo/seed database. It is **not** used at
runtime in production. Use it only as the migration source:

```
demo_database.db  →  scripts/migrate_sqlite_to_postgres.py  →  PostgreSQL (business schema)
```

## Demo Domain

The business schema models a medical billing BPO:

| Table | Purpose |
|-------|---------|
| `customers` | Caller / account holder profiles |
| `billing_accounts` | Insurance + outstanding balance |
| `claims` | Insurance claims and denial reasons |
| `invoices` | Customer invoices and amounts due |
| `payments` | Payment attempts and statuses |
| `claim_adjustments` | Claim-level adjustments |
| `tickets` | Support tickets |
| `ticket_comments` | Ticket history comments |

Deterministic seed scenarios include approved/denied/appealed claims, overdue invoices,
failed payments, and open/escalated/resolved tickets (for example `CLM10002`, `INV10001`,
`TKT10001`).

## Prerequisites

- Node.js 18+
- Python 3.10+
- PostgreSQL 14+ (local development; Render provides this in production)
- LiveKit Cloud or self-hosted LiveKit server
- Gemini API key

## Setup (local)

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Create a local database (example):

```bash
psql -U postgres -c "CREATE DATABASE voice_agent;"
```

3. Set `DATABASE_URL` in `.env`, for example:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/voice_agent
SQL_MCP_DIALECT=postgresql
SQL_MCP_SCHEMA=business
```

4. Install frontend dependencies:

```bash
npm install
```

5. Install Python dependencies:

```bash
pip3 install -r backend/requirements.txt
pip3 install -e sql-mcp
pip3 install -e doc-retrieval
pip3 install -r voice-agent/requirements.txt
```

6. Rebuild the SQLite seed file if needed (optional; `demo_database.db` already exists):

```bash
npm run init:demo-db
# or: python scripts/init_demo_database.py
```

7. Migrate SQLite business data into PostgreSQL (also creates RAG tables if missing):

```bash
npm run migrate:postgres
# or: python scripts/migrate_sqlite_to_postgres.py --init-rag
```

Safe by default: existing PostgreSQL business data is not overwritten. To rebuild the
`business` schema only (never `public` RAG tables):

```bash
python scripts/migrate_sqlite_to_postgres.py --reset --init-rag
```

8. Verify row counts:

```bash
npm run verify:postgres
# or: python scripts/migrate_sqlite_to_postgres.py --verify
```

9. Start the stack:

```bash
# Terminal 1 — API + frontend
npm run dev

# Terminal 2 — LiveKit voice agent worker
npm run dev:voice-agent
```

- Frontend: http://localhost:3000
- FastAPI: http://localhost:8000
- API docs: http://localhost:8000/docs

SQL-MCP in development can still be pointed at SQLite with `SQL_MCP_DIALECT=sqlite` and
`SQL_MCP_DATABASE=demo_database.db` for debugging the seed file. Do not use that in
production (`RENDER` / `APP_ENV=production` refuse SQLite).

### Demo policy documents

Fictional operational policies live in `demo-docs/`:

- `medical_billing_customer_service_policy.md`
- `claim_denial_and_appeal_policy.md`
- `insurance_processing_guidelines.md`
- `billing_escalation_policy.md`
- `payment_and_refund_policy.md`

Upload these through the document drawer to exercise `search_documents` grounding.
They are demo content only — not real healthcare/legal policy.

### Fast path (low-latency tool selection)

Both the FastAPI text chat and the LiveKit voice agent share the same design:
schema/documents are introspected **once at startup**, compiled into a small,
fixed set of tools, and handed to the model — no runtime discovery, no
freeform SQL generation for common lookups.

**`sql-mcp`** compiles the connected schema into deterministic per-table tools:

- `get_<table>_by_id`, `list_<table>`, `count_<table>` — reads
- `create_<table>`, `update_<table>_by_id`, `delete_<table>_by_id` — writes,
  gated behind an explicit `confirmed=true` the model only sets after the
  user has actually confirmed out loud
- `run_custom_read_query` — last-resort read-only SQL for analytics/joins a
  specific tool can't express

**Ticket workflow tools** (voice + chat):

- `check_ticket` — retrieve ticket status/details
- `create_ticket` — create a ticket only after explicit confirmation
- `update_ticket` — update fields / append comments only after confirmation

**`doc-retrieval`** exposes `search_documents` for policy/process questions only.

## LiveKit Voice

1. Configure `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in `.env`
2. Start the voice agent worker: `npm run dev:voice-agent`
3. Click the live call button in the UI to join a LiveKit room

## Example Voice Scenarios

1. "I want to know why my claim was denied." → retrieve `CLM10002` denial reason
2. "What is my outstanding balance?" → billing/invoice lookup
3. "What's the status of ticket TKT10001?" → `check_ticket`
4. "I want to open a ticket because my claim was denied." → gather details, confirm, then create
5. "Update ticket TKT10001 and tell them I submitted the authorization documents." → confirm, then update
6. "What is the policy for appealing a denied claim?" → `search_documents`
7. "What is the status of claim CLM10004?" → database tools (not documents)

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `POST /api/chat` | Text chat with sql-mcp + ticket + document tools |
| `POST /api/livekit/token` | LiveKit room token |
| `GET /api/sql-mcp/column-context` | Schema inspector data |
| `POST /api/sql-mcp/call-tool` | Direct tool invocation |
| `GET/POST /api/documents/*` | Document upload & RAG |

## Tests

```bash
npm run test:demo
# or: python -m pytest sql-mcp/tests -q
```

SQLite tests exercise the seed file. PostgreSQL tests run against the migrated
`business` schema when `DATABASE_URL` / local Postgres is reachable.

## Deploy on Render

The repo includes `render.yaml` (Singapore region) with:

- Render PostgreSQL (`voice_agent`)
- Web service (Vite build + FastAPI, serves `dist/` and `/api/*`)
- LiveKit worker (`python voice-agent/agent.py start`)

**Build (Docker):** `npm ci && npm run build` plus Python installs (see `Dockerfile`).

**Start (web):** `python scripts/migrate_sqlite_to_postgres.py --init-rag` then
`python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT` from `backend/`.

Set these in the Render dashboard (Blueprint `sync: false` keys):

- `GEMINI_API_KEY` / `GOOGLE_API_KEY`
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `APP_URL` (the public web service URL)

`DATABASE_URL` is wired from the Render database **internal** connection string.
Do not paste the external hostname into the web service when it runs in the same region.

pgvector is **not** required. RAG stores embeddings as `TEXT` in `public.document_chunks`.

## What Changed (v5 — PostgreSQL production)

- SQL-MCP business data lives in PostgreSQL schema `business`
- RAG/document tables remain in PostgreSQL `public`
- SQLite `demo_database.db` is seed/migration source only
- Added `scripts/migrate_sqlite_to_postgres.py` and Render/Docker packaging

## What Changed (v4 — Medical Billing BPO)

- Replaced patient/lab-test demo data with a medical billing BPO schema and seed set
- Added deterministic `scripts/init_demo_database.py`
- Added semantic ticket tools with confirmation gating
- Rewrote Natasha's prompt for professional billing support behavior
- Added fictional billing policy documents for RAG demos

## What Changed (v3)

- Restored the compiled-manifest fast path from the original `db-agent`
- Added `doc-retrieval` as a standalone RAG tool independent of sql-mcp
- LiveKit voice agent gained document search
- `/api/chat` no longer unconditionally embeds document context on every message
