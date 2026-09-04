# db-agent

Dialect-agnostic database agent skeleton: connect to a tenant's Postgres or MySQL
database, compile a bounded set of typed tools from its schema, and execute those
tools with guardrails. This is the "fast path" from the manifest-compilation
architecture — no vector search or SQL generation on the hot path.

## Structure

```
src/
  types.ts                    shared types across the whole package
  adapters/                   DBAdapter interface + Postgres/MySQL implementations
  introspection/               SchemaIntrospector + schema hashing (drift detection)
  manifest/                   ManifestCompiler (schema -> tools), ManifestStore, LLM tool-schema export
  guardrails/                 param validation, row caps, write confirmation
  executor/                   FastPathExecutor — runs a named tool against real params
  agent/DatabaseAgent.ts      top-level class tying it all together
example/
  usage.ts                    end-to-end example against a real DB (needs DB_* env vars)
  test-compiler.ts            manifest compilation against synthetic schema, no DB needed
  test-guardrails.ts          guardrail logic checks, no DB needed
```

## Quick start

```bash
npm install
npx tsc --noEmit          # type-check
npx tsx example/test-compiler.ts     # verify compilation logic, no DB needed
npx tsx example/test-guardrails.ts   # verify guardrail logic, no DB needed
npx tsx example/usage.ts             # full flow against a real Postgres DB (set DB_* env vars)
```

## Core flow

```ts
const agent = new DatabaseAgent({
  tenantId: 'acme-corp',
  dialect: 'postgres', // or 'mysql'
  host, port, user, password, database,
});

// Run at onboarding, and again on a schema-change webhook/schedule.
// Cheap to call repeatedly — it's a no-op recompile if the schema hash is unchanged.
await agent.syncManifest();

// Hand straight to your LLM's function-calling config.
const tools = agent.getToolSchemas();

// Reads execute immediately.
const order = await agent.callTool('get_orders_by_id', { id: 123 });

// Writes require an explicit confirmation round-trip by default.
const preview = await agent.callTool('update_orders_by_id', { id: 123, status: 'shipped' });
// preview.status === 'confirmation_required'

const applied = await agent.callTool(
  'update_orders_by_id',
  { id: 123, status: 'shipped' },
  { confirmed: true }
);
```

## Testing the pipeline with seed data

You don't need a customer database or Docker for this — a local Postgres is enough,
and the steps below are exactly what was used to validate this package.

**1. Install and start Postgres locally** (Debian/Ubuntu-style; adjust for your OS):

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start

sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'testpass';"
sudo -u postgres psql -c "CREATE DATABASE acme_test;"
```

**2. Load the checked-in seed schema + data** (`example/seed.sql`):

```bash
sudo -u postgres psql -d acme_test -f example/seed.sql
```

This creates a small `customers` / `orders` schema with a couple of rows each —
enough to exercise every tool the compiler generates (get, list, count, create,
update, delete) without needing a real tenant's database.

**3. Run the test scripts, in order of how much they depend on a live DB:**

```bash
# No DB required — validates the manifest compiler against synthetic schema data
npx tsx example/test-compiler.ts

# No DB required — validates guardrail logic (confirmation gating, param whitelisting, row caps)
npx tsx example/test-guardrails.ts

# Requires the live DB from steps 1-2 — full round trip: introspect, compile,
# read, write-preview, write-confirm, param-injection rejection, unknown-tool handling
DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_PASSWORD=testpass DB_NAME=acme_test \
  npx tsx example/live-check.ts
```

`live-check.ts` is the most useful one to read through — it exercises every
guardrail path (confirmation required, rejected injection attempt, tool not in
manifest) against real query results, not mocks.

**Resetting between test runs**, since `live-check.ts` mutates `orders.status`:

```bash
sudo -u postgres psql -d acme_test -c "drop table if exists orders, customers cascade;"
sudo -u postgres psql -d acme_test -f example/seed.sql
```

**Testing against MySQL instead**: same shape, just install `mysql-server`,
create an equivalent schema (drop the `serial`/`references` syntax for MySQL's
`AUTO_INCREMENT`/`FOREIGN KEY` equivalents), and pass `dialect: 'mysql'` with the
matching port (3306) in the connection config.

## Pairing this with Natasha

The DatabaseAgent is designed to sit behind Groq's function-calling as one more
tool in Natasha's tool registry, alongside comms/CRM/escalation tools discussed
earlier. See `example/natasha-integration.ts` for a working reference; the
pattern in short:

**1. Format conversion** — Groq (OpenAI-compatible) expects a different shape than
`getToolSchemas()` returns:

```ts
function toGroqTools(schemas: ReturnType<DatabaseAgent['getToolSchemas']>) {
  return schemas.map((s) => ({
    type: 'function' as const,
    function: { name: s.name, description: s.description, parameters: s.input_schema },
  }));
}
```

Pass the result straight into the `tools` param of your chat completion call.

**2. One agent instance per tenant, kept alive** — `syncManifest()` is cheap to
re-call (it's a no-op recompile when the schema hash hasn't changed), but there's
no reason to reconnect on every turn. Cache the `DatabaseAgent` per tenant for
the life of the session or process:

```ts
const tenantAgents = new Map<string, DatabaseAgent>();

async function getAgentForTenant(tenantId: string) {
  let agent = tenantAgents.get(tenantId);
  if (!agent) {
    agent = new DatabaseAgent(await loadConnectionConfigFor(tenantId)); // from your credential vault
    await agent.syncManifest();
    tenantAgents.set(tenantId, agent);
  }
  return agent;
}
```

**3. Route Groq's `tool_calls` straight into `callTool`**, and branch on `status`:

- `'ok'` — speak the result back.
- `'confirmation_required'` — speak `pendingChange` back as a yes/no question
  instead of applying the write. The caller's confirmation becomes the next
  turn's tool call, this time with `{ confirmed: true }`. No separate state
  machine needed — the guardrail itself drives the voice confirmation UX.
- `'not_found'` — the tool name Groq picked isn't in this tenant's manifest.
  This is the exact seam where the slow-path (dynamic NL2SQL) fallback plugs in
  later. Until that exists, degrade gracefully ("let me get someone to help")
  rather than failing silently.
- `'error'` — surface a generic retry/rephrase prompt; log `result.error`
  server-side for debugging, don't read it aloud.

**4. Refresh manifests on schema change** — call `syncManifest()` again whenever
a tenant's schema-change webhook fires (or on a periodic schedule as a fallback).
It's safe to call it unconditionally on every session start too, since the hash
check keeps the common case free.

## What's deliberately NOT here yet (next increments)

- **Slow-path fallback**: when `callTool` returns `status: 'not_found'`, that's the
  signal to route to the dynamic NL2SQL + schema-retrieval path discussed earlier.
  Not implemented here — this skeleton is the fast path only.
- **Credential vault**: `ConnectionConfig` currently takes plaintext connection
  details. Swap in a secrets-manager-backed loader before this touches real
  tenant credentials — the interface boundary (`ConnectionConfig` in, `DBAdapter`
  out) is designed so that's a drop-in change in `adapters/index.ts`.
- **Persistent manifest store**: `InMemoryManifestStore` is dev-only. Implement
  `ManifestStore` against Postgres/Redis for production so manifests survive
  restarts and are shared across instances.
- **Audit logging**: every `callTool` result is a natural hook point — wrap
  `FastPathExecutor.callTool` or add a logging layer in `DatabaseAgent`.
- **Service wrapper**: this is a library today. Lifting it into its own process
  (HTTP or MCP server) is a thin wrapper around `DatabaseAgent` — the core logic
  doesn't need to change.
