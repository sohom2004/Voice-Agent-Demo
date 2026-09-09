# Natasha Medical Billing BPO Voice Agent

Natasha is a professional **medical billing BPO customer-service voice agent** demo.
It helps callers with billing accounts, claims, invoices, payments, and support tickets
using **LiveKit + Gemini Live** for low-latency voice, **sql-mcp** for compiled database
tools, and **doc-retrieval** for policy document grounding.

## Architecture

```
React Frontend (Vite)  →  FastAPI Backend  →  PostgreSQL / SQLite (documents/RAG)
                              ↓                        ↑
                         sql-mcp (fast-path)     doc-retrieval (fast-path RAG)
                              ↓
                    SQLite medical-billing demo DB

LiveKit Room  ↔  LiveKit Voice Agent (Python)  ↔  sql-mcp fast-path tools
                                                ↔  ticket workflow tools
                                                ↔  doc-retrieval search tool
```

Database access and document RAG remain two **independent** tools, both compiled/cached
once at startup rather than discovered per turn.

## Demo Domain

The default SQLite database models a medical billing BPO:

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
- PostgreSQL (for document storage; SQLite fallback is supported)
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

4. Initialize (or rebuild) the medical billing demo database:

```bash
npm run init:demo-db
# or: python3 scripts/init_demo_database.py
```

5. Start the stack:

```bash
# Terminal 1 — API + frontend
npm run dev

# Terminal 2 — LiveKit voice agent worker
npm run dev:voice-agent
```

- Frontend: http://localhost:3000
- FastAPI: http://localhost:8000
- API docs: http://localhost:8000/docs

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
# or: python3 -m pytest sql-mcp/tests -q
```

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
