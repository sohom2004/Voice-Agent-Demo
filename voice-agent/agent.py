from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# LiveKit Google realtime plugin expects GOOGLE_API_KEY; keep GEMINI_API_KEY compatible.
_GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
_GOOGLE_KEY = os.getenv("GOOGLE_API_KEY", "")
if _GEMINI_KEY and not _GOOGLE_KEY:
    os.environ["GOOGLE_API_KEY"] = _GEMINI_KEY
API_KEY = os.getenv("GOOGLE_API_KEY") or _GEMINI_KEY

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    MetricsCollectedEvent,
    RunContext,
    cli,
    function_tool,
    metrics,
)
from livekit.plugins import google

SQL_MCP_ROOT = ROOT / "sql-mcp"
BACKEND_ROOT = ROOT / "backend"
if str(SQL_MCP_ROOT) not in sys.path:
    sys.path.insert(0, str(SQL_MCP_ROOT))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sql_mcp.engine import SqlMcpEngine
from sql_mcp.models import ConnectionConfig
from app.services.documents import document_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent")

GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview"

engine = SqlMcpEngine(
    ConnectionConfig(
        tenant_id=os.getenv("SQL_MCP_TENANT_ID", "default_tenant"),
        dialect=os.getenv("SQL_MCP_DIALECT", "sqlite"),
        host=os.getenv("SQL_MCP_HOST", "localhost"),
        port=int(os.getenv("SQL_MCP_PORT", "5432")),
        user=os.getenv("SQL_MCP_USER", "postgres"),
        password=os.getenv("SQL_MCP_PASSWORD", "postgres"),
        database=os.getenv("SQL_MCP_DATABASE", str(ROOT / "demo_database.db")),
    )
)

server = AgentServer()
_documents_ready = asyncio.Event()


@dataclass
class SessionContext:
    workspace_id: str = "default_workspace"
    document_ids: list[str] = field(default_factory=list)
    voice_name: str = "Kore"


def _parse_session_metadata(raw: str | None, attributes: dict[str, str] | None = None) -> SessionContext:
    ctx = SessionContext()
    attributes = attributes or {}

    if attributes.get("workspace_id"):
        ctx.workspace_id = attributes["workspace_id"]
    if attributes.get("document_ids"):
        try:
            parsed_ids = json.loads(attributes["document_ids"])
            if isinstance(parsed_ids, list):
                ctx.document_ids = [str(x) for x in parsed_ids]
        except json.JSONDecodeError:
            logger.warning("Invalid document_ids attribute: %s", attributes.get("document_ids"))

    if raw:
        try:
            data = json.loads(raw)
            ctx.workspace_id = data.get("workspace_id") or data.get("workspaceId") or ctx.workspace_id
            docs = data.get("document_ids") or data.get("documentIds") or ctx.document_ids
            if isinstance(docs, list):
                ctx.document_ids = [str(x) for x in docs]
            ctx.voice_name = data.get("voice_name") or data.get("voiceName") or ctx.voice_name
        except json.JSONDecodeError:
            logger.warning("Invalid participant metadata JSON: %s", raw)

    return ctx


async def _timed_tool(name: str, sync_fn, *args, **kwargs) -> str:
    started = time.perf_counter()
    logger.info("[latency] tool_start name=%s", name)
    try:
        result = await asyncio.to_thread(sync_fn, *args, **kwargs)
        payload = json.dumps(result)
        logger.info(
            "[latency] tool_complete name=%s duration_ms=%.0f",
            name,
            (time.perf_counter() - started) * 1000,
        )
        return payload
    except Exception as exc:
        logger.exception("[latency] tool_error name=%s error=%s", name, exc)
        return json.dumps({"error": str(exc)})


@function_tool
async def list_tables(context: RunContext) -> str:
    """List all tables in the connected database."""
    return await _timed_tool("list_tables", engine.call_tool, "list_tables", {})


@function_tool
async def describe_table(context: RunContext, table_name: str) -> str:
    """Describe columns for a database table."""
    return await _timed_tool(
        "describe_table",
        engine.call_tool,
        "describe_table",
        {"table_name": table_name},
    )


@function_tool
async def execute_read(context: RunContext, sql: str) -> str:
    """Run a SELECT query against the database."""
    return await _timed_tool("execute_read", engine.call_tool, "execute_read", {"sql": sql})


@function_tool
async def execute_write(context: RunContext, sql: str, confirmed: bool = False) -> str:
    """Run INSERT, UPDATE, or DELETE. Set confirmed=true after user approval."""
    return await _timed_tool(
        "execute_write",
        engine.call_tool,
        "execute_write",
        {"sql": sql, "confirmed": confirmed},
    )


@function_tool
async def search_documents(
    context: RunContext,
    query: str,
    document_ids: list[str] | None = None,
    top_k: int = 5,
) -> str:
    """
    Search uploaded documents for relevant passages.
    Use this when the user asks about uploaded files, contracts, reports, or policies.
    """
    started = time.perf_counter()
    logger.info("[latency] tool_start name=search_documents query=%r", query[:120])

    await _documents_ready.wait()
    session_ctx: SessionContext = context.userdata
    # Prefer explicit tool args; otherwise use the documents selected for this LiveKit session.
    if document_ids is not None:
        effective_ids: list[str] | None = [str(x) for x in document_ids]
    elif session_ctx.document_ids:
        effective_ids = list(session_ctx.document_ids)
    else:
        # No session selection provided — search the whole workspace.
        effective_ids = None

    try:
        results = await document_service.search_documents(
            session_ctx.workspace_id,
            query,
            effective_ids,
            top_k=max(1, min(int(top_k or 5), 10)),
        )
        payload = {"results": results, "count": len(results)}
        logger.info(
            "[latency] tool_complete name=search_documents duration_ms=%.0f hits=%s workspace=%s docs=%s",
            (time.perf_counter() - started) * 1000,
            len(results),
            session_ctx.workspace_id,
            effective_ids,
        )
        return json.dumps(payload)
    except Exception as exc:
        logger.exception("[latency] tool_error name=search_documents error=%s", exc)
        return json.dumps({"error": str(exc), "results": []})


INSTRUCTIONS = """You are Natasha, an intelligent, warm, highly adaptive, and polyglot real-time voice companion.
Your tone is professional, conversational, approachable, empathetic, eloquent, and witty when appropriate.

# LANGUAGE
- Dynamically detect the user's language and respond in that same language.
- Support code-mixing such as Hinglish without asking the user to configure a language.

# VOICE STYLE
- Keep answers concise and spoken aloud. Avoid markdown, bullet characters, hashtags, code fences, and raw JSON.
- Summarize numbers and data conversationally instead of reading raw tables.
- Never ask users for table names, SQL, or technical database details unless they ask.

# DOCUMENT GROUNDING
- When a question depends on uploaded documents, contracts, reports, policies, or file contents, call search_documents before answering.
- Ground document answers strictly in retrieved chunks. Cite the document name and page when available.
- If retrieval returns no sufficiently relevant information, say you could not find that information in the available documents. Do not fabricate document content.
- Do NOT call search_documents for general knowledge, math, chitchat, or unrelated questions.

# DATABASE TOOLS
- Use list_tables, describe_table, and execute_read for live operational database questions.
- Use execute_write only after the user clearly confirms a change.
- Distinguish clearly between:
  1) facts found in documents,
  2) general knowledge,
  3) information obtained from database tools.

# TURN TAKING
- Stop speaking immediately if the user interrupts.
- Wait for the user to finish before responding.
"""


class NatashaAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=INSTRUCTIONS,
            tools=[list_tables, describe_table, execute_read, execute_write, search_documents],
        )


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    await ctx.connect()

    global _documents_ready
    if not _documents_ready.is_set():
        if document_service.pool is None and not document_service.use_sqlite:
            await document_service.connect()
        _documents_ready.set()

    participant = await ctx.wait_for_participant()
    session_ctx = _parse_session_metadata(participant.metadata, dict(participant.attributes or {}))
    logger.info(
        "Session context workspace=%s document_ids=%s voice=%s",
        session_ctx.workspace_id,
        session_ctx.document_ids,
        session_ctx.voice_name,
    )

    if not API_KEY:
        raise RuntimeError("GEMINI_API_KEY or GOOGLE_API_KEY is required for Gemini Live.")

    # Gemini Live has built-in turn detection; do not add Silero VAD or STT→LLM→TTS.
    session = AgentSession(
        llm=google.realtime.RealtimeModel(
            model=GEMINI_LIVE_MODEL,
            voice=session_ctx.voice_name or "Kore",
            api_key=API_KEY,
            instructions=INSTRUCTIONS,
        ),
        userdata=session_ctx,
    )

    usage_collector = metrics.UsageCollector()

    @session.on("metrics_collected")
    def _on_metrics(ev: MetricsCollectedEvent) -> None:
        metrics.log_metrics(ev.metrics)
        usage_collector.collect(ev.metrics)
        m = ev.metrics
        metric_type = getattr(m, "type", type(m).__name__)
        details: dict[str, Any] = {"type": metric_type}
        for attr in (
            "ttft",
            "duration",
            "end_of_utterance_delay",
            "transcription_delay",
            "on_user_turn_completed_delay",
            "session_duration",
            "tokens_per_second",
        ):
            if hasattr(m, attr):
                details[attr] = getattr(m, attr)
        logger.info("[latency] metrics %s", details)

    @session.on("user_state_changed")
    def _on_user_state(ev) -> None:
        logger.info("[latency] user_state=%s", getattr(ev, "new_state", ev))

    @session.on("agent_state_changed")
    def _on_agent_state(ev) -> None:
        logger.info("[latency] agent_state=%s", getattr(ev, "new_state", ev))

    @session.on("function_tools_executed")
    def _on_tools(ev) -> None:
        names = []
        for item in getattr(ev, "function_calls", []) or []:
            names.append(getattr(item, "name", str(item)))
        logger.info("[latency] tools_executed names=%s", names)

    await session.start(agent=NatashaAgent(), room=ctx.room)
    # gemini-3.1-flash-live-preview rejects generate_reply / mid-session client content.
    # The model greets on the user's first turn via instructions.


if __name__ == "__main__":
    cli.run_app(server)
