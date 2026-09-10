from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

# LiveKit Google realtime plugin expects GOOGLE_API_KEY.
_GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
_GOOGLE_KEY = os.getenv("GOOGLE_API_KEY", "")
if _GEMINI_KEY and not _GOOGLE_KEY:
    os.environ["GOOGLE_API_KEY"] = _GEMINI_KEY
API_KEY = os.getenv("GOOGLE_API_KEY") or _GEMINI_KEY

from livekit import rtc  # noqa: E402
from livekit.agents import (  # noqa: E402
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    TurnHandlingOptions,
    cli,
    function_tool,
)
from livekit.plugins import google  # noqa: E402
from google.genai import types as genai_types  # noqa: E402

SQL_MCP_ROOT = ROOT / "sql-mcp"
DOC_RETRIEVAL_ROOT = ROOT / "doc-retrieval"
BACKEND_ROOT = ROOT / "backend"
for pkg_root in (SQL_MCP_ROOT, DOC_RETRIEVAL_ROOT, BACKEND_ROOT):
    if str(pkg_root) not in sys.path:
        sys.path.insert(0, str(pkg_root))

from sql_mcp.agent_prompt import build_system_prompt  # noqa: E402
from sql_mcp.engine import SqlMcpEngine  # noqa: E402
from sql_mcp.manifest import describe_manifest_for_prompt, to_raw_schema  # noqa: E402
from sql_mcp.models import ConnectionConfig  # noqa: E402
from sql_mcp.ticket_workflow import (  # noqa: E402
    TICKET_TOOL_DEFINITIONS,
    dispatch_ticket_tool,
)

from doc_retrieval import DocRetrievalEngine, RetrievalConfig  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent")

GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview"
DEFAULT_TENANT_ID = os.getenv("SQL_MCP_TENANT_ID", "default_tenant")


def _resolve_db_path(raw: str) -> str:
    path = Path(raw or "demo_database.db")
    if not path.is_absolute():
        path = (ROOT / path).resolve()
    return str(path)


def _env_connection_config(tenant_id: str = DEFAULT_TENANT_ID) -> ConnectionConfig:
    return ConnectionConfig(
        tenant_id=tenant_id,
        dialect=os.getenv("SQL_MCP_DIALECT", "sqlite"),  # type: ignore[arg-type]
        host=os.getenv("SQL_MCP_HOST", "localhost"),
        port=int(os.getenv("SQL_MCP_PORT", "5432")),
        user=os.getenv("SQL_MCP_USER", "postgres"),
        password=os.getenv("SQL_MCP_PASSWORD", "postgres"),
        database=_resolve_db_path(os.getenv("SQL_MCP_DATABASE", "demo_database.db")),
    )


def _load_connection_config(tenant_id: str = DEFAULT_TENANT_ID) -> ConnectionConfig:
    """Prefer the workspace DB configured via the setup/control path.

    Schema discovery/connect/refresh stay on that setup path. The voice
    session only loads the already-selected connection and compiles tools
    once — never during a normal spoken turn. Env vars remain the fallback.
    """
    try:
        from app.services.connection_registry import get_active_config_for_voice

        persisted = get_active_config_for_voice(tenant_id)
        if persisted is not None:
            if persisted.dialect == "sqlite":
                persisted.database = _resolve_db_path(persisted.database)
            logger.info(
                "Using persisted sql-mcp connection for %s (%s / %s)",
                tenant_id,
                persisted.dialect,
                persisted.database,
            )
            return persisted
    except Exception as exc:
        logger.warning("Persisted sql-mcp connection unavailable (%s); using env defaults", exc)
    return _env_connection_config(tenant_id)


# ---------------------------------------------------------------------------
# Database: compiled fast-path tools (schema introspected once at startup /
# session bind — not during normal voice turns).
# ---------------------------------------------------------------------------

engine = SqlMcpEngine(_load_connection_config())
_manifest = engine.compile_manifest()
_schema_snapshot = engine.get_schema_snapshot()
_DB_SCHEMA_SUMMARY = describe_manifest_for_prompt(_manifest, _schema_snapshot)
_db_path = engine.config.database

logger.info(
    "Compiled %d fast-path database tool(s) from %d table(s): %s",
    len(_manifest.tools),
    len(_schema_snapshot.tables),
    ", ".join(t.name for t in _manifest.tools),
)

# Set for each LiveKit session so tool wrappers can publish UI events.
_active_room: Any | None = None


async def _publish_event(payload: dict[str, Any]) -> None:
    room = _active_room
    if room is None:
        return
    try:
        await room.local_participant.publish_data(
            json.dumps(payload, default=str).encode("utf-8"),
            reliable=True,
        )
    except Exception as exc:
        logger.debug("Voice UI event publish failed: %s", exc)


def _activity_label(tool_name: str, phase: str) -> str:
    pretty = tool_name.replace("_", " ")
    if phase == "start":
        if tool_name.startswith(("get_", "list_", "count_")) or tool_name == "run_custom_read_query":
            return f"Checking database ({pretty})..."
        if tool_name.startswith("search_"):
            return f"Searching documents ({pretty})..."
        if "ticket" in tool_name:
            return f"Working on ticket ({pretty})..."
        return f"Running {pretty}..."
    if tool_name.startswith(("get_", "list_", "count_")) or tool_name == "run_custom_read_query":
        return "Database lookup completed."
    if tool_name.startswith("search_"):
        return "Document search completed."
    if "ticket" in tool_name:
        return "Ticket action completed."
    return f"{pretty} completed."


def _make_fast_path_tool(tool_name: str):
    """Build one LiveKit tool for a single compiled manifest tool."""

    async def _handler(raw_arguments: dict[str, Any]) -> str:
        await _publish_event(
            {
                "type": "model_activity",
                "phase": "start",
                "tool": tool_name,
                "text": _activity_label(tool_name, "start"),
            }
        )
        result = engine.call_manifest_tool(tool_name, raw_arguments)
        await _publish_event(
            {
                "type": "model_activity",
                "phase": "done",
                "tool": tool_name,
                "status": result.get("status"),
                "text": _activity_label(tool_name, "done"),
            }
        )
        return json.dumps(result, default=str)

    _handler.__name__ = tool_name
    tool_def = _manifest.find(tool_name)
    assert tool_def is not None
    return function_tool(_handler, raw_schema=to_raw_schema(tool_def))


DB_FAST_PATH_TOOLS = [_make_fast_path_tool(t.name) for t in _manifest.tools]


@function_tool
async def run_custom_read_query(sql: str) -> str:
    """LAST RESORT database tool. Run a read-only SQL SELECT for analytics
    or joins that none of the specific get_/list_/count_ tools can express.
    Prefer a specific table tool whenever one fits. Never use this for writes."""
    await _publish_event(
        {
            "type": "model_activity",
            "phase": "start",
            "tool": "run_custom_read_query",
            "text": _activity_label("run_custom_read_query", "start"),
        }
    )
    result = engine.execute_read(sql)
    await _publish_event(
        {
            "type": "model_activity",
            "phase": "done",
            "tool": "run_custom_read_query",
            "status": result.get("status"),
            "text": _activity_label("run_custom_read_query", "done"),
        }
    )
    return json.dumps(result, default=str)


def _make_ticket_tool(tool_def: dict[str, Any]):
    tool_name = tool_def["name"]

    async def _handler(raw_arguments: dict[str, Any]) -> str:
        await _publish_event(
            {
                "type": "model_activity",
                "phase": "start",
                "tool": tool_name,
                "text": _activity_label(tool_name, "start"),
            }
        )
        result = dispatch_ticket_tool(_db_path, tool_name, raw_arguments or {})
        await _publish_event(
            {
                "type": "model_activity",
                "phase": "done",
                "tool": tool_name,
                "status": result.get("status"),
                "text": _activity_label(tool_name, "done"),
            }
        )
        return json.dumps(result, default=str)

    _handler.__name__ = tool_name
    return function_tool(
        _handler,
        raw_schema={
            "name": tool_def["name"],
            "description": tool_def["description"],
            "parameters": tool_def["parameters"],
        },
    )


TICKET_TOOLS = [_make_ticket_tool(t) for t in TICKET_TOOL_DEFINITIONS]
logger.info("Registered ticket workflow tools: %s", ", ".join(t["name"] for t in TICKET_TOOL_DEFINITIONS))


# ---------------------------------------------------------------------------
# Documents: dedicated retrieval tool (independent of sql-mcp).
# ---------------------------------------------------------------------------

_upload_dir = os.getenv("UPLOAD_DIR", "uploads")
_upload_path = Path(_upload_dir)
if not _upload_path.is_absolute():
    _upload_path = (ROOT / _upload_path).resolve()

doc_engine = DocRetrievalEngine(
    RetrievalConfig(
        upload_dir=str(_upload_path),
        gemini_api_key=API_KEY or "",
        pg_host=os.getenv("PGHOST", "localhost"),
        pg_port=int(os.getenv("PGPORT", "5432")),
        pg_user=os.getenv("PGUSER", "postgres"),
        pg_password=os.getenv("PGPASSWORD", ""),
        pg_database=os.getenv("PGDATABASE", "postgres"),
    )
)


@function_tool
async def search_documents(query: str) -> str:
    """Search uploaded operational documents and billing policies for process
    guidance. Use ONLY for policy/procedure questions — never for live
    customer, claim, invoice, payment, or ticket record lookups."""
    await _publish_event(
        {
            "type": "model_activity",
            "phase": "start",
            "tool": "search_documents",
            "text": _activity_label("search_documents", "start"),
        }
    )
    # Fresh lookup each tool call so recent uploads are visible without waiting
    # out the short in-memory cache TTL.
    doc_engine.invalidate()
    if not doc_engine.has_any_documents():
        result = "No documents have been uploaded yet."
    else:
        results = doc_engine.search(query, top_k=5)
        if not results:
            result = "Nothing relevant was found in the uploaded documents."
        else:
            result = doc_engine.format_context(results)
    await _publish_event(
        {
            "type": "model_activity",
            "phase": "done",
            "tool": "search_documents",
            "text": _activity_label("search_documents", "done"),
        }
    )
    return result


def _configs_match(a: ConnectionConfig, b: ConnectionConfig) -> bool:
    return (
        a.dialect == b.dialect
        and a.host == b.host
        and a.port == b.port
        and a.user == b.user
        and a.password == b.password
        and a.database == b.database
        and (a.connection_url or None) == (b.connection_url or None)
    )


def _bind_session_database(tenant_id: str) -> str:
    """Reload workspace connection and compile tools once for this session."""
    global engine, _manifest, _schema_snapshot, _DB_SCHEMA_SUMMARY, _db_path
    global DB_FAST_PATH_TOOLS, TICKET_TOOLS

    config = _load_connection_config(tenant_id)
    if not _configs_match(engine.config, config):
        engine.close()
        engine = SqlMcpEngine(config)

    _manifest = engine.compile_manifest()
    _schema_snapshot = engine.get_schema_snapshot()
    _DB_SCHEMA_SUMMARY = describe_manifest_for_prompt(_manifest, _schema_snapshot)
    _db_path = engine.config.database
    DB_FAST_PATH_TOOLS = [_make_fast_path_tool(t.name) for t in _manifest.tools]
    if engine.config.dialect == "sqlite":
        TICKET_TOOLS = [_make_ticket_tool(t) for t in TICKET_TOOL_DEFINITIONS]
    else:
        TICKET_TOOLS = []
        logger.info("Ticket tools omitted for non-sqlite dialect %s", engine.config.dialect)

    logger.info(
        "Session DB bound: %s schema_hash=%s tools=%d",
        engine.config.redacted_dict(),
        _schema_snapshot.schema_hash,
        len(_manifest.tools),
    )
    return build_system_prompt(_DB_SCHEMA_SUMMARY)


def _wire_transcript_events(session: AgentSession) -> None:
    """Forward existing realtime transcript signals to the frontend data channel.

    Uses LiveKit/Gemini session events already produced by the runtime —
    no extra LLM calls and no fabricated chain-of-thought.
    """

    def _text_of(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        for attr in ("transcript", "text", "content"):
            maybe = getattr(value, attr, None)
            if isinstance(maybe, str) and maybe.strip():
                return maybe
        return str(value)

    if not hasattr(session, "on"):
        return

    def _on_user(ev: Any = None, **kwargs: Any) -> None:
        import asyncio

        payload = ev if ev is not None else kwargs
        text = _text_of(payload).strip()
        if text:
            asyncio.create_task(_publish_event({"type": "user_transcript", "text": text}))

    def _on_agent(ev: Any = None, **kwargs: Any) -> None:
        import asyncio

        payload = ev if ev is not None else kwargs
        text = _text_of(payload).strip()
        if not text:
            return
        is_final = bool(getattr(payload, "is_final", getattr(payload, "final", False)))
        asyncio.create_task(
            _publish_event({"type": "agent_transcript", "text": text, "final": is_final})
        )

    for event_name, handler in (
        ("user_input_transcribed", _on_user),
        ("user_transcript", _on_user),
        ("agent_speech_transcription", _on_agent),
        ("agent_transcript", _on_agent),
    ):
        try:
            session.on(event_name)(handler)
        except Exception:
            try:
                session.on(event_name, handler)
            except Exception:
                pass


INSTRUCTIONS = build_system_prompt(_DB_SCHEMA_SUMMARY)

server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    global _active_room

    await ctx.connect()
    _active_room = ctx.room

    if not API_KEY:
        raise RuntimeError("GEMINI_API_KEY or GOOGLE_API_KEY is required for Gemini Live.")

    tenant_id = DEFAULT_TENANT_ID
    try:
        meta = json.loads(ctx.room.metadata or "{}")
        tenant_id = (
            meta.get("tenantId")
            or meta.get("workspaceId")
            or meta.get("tenant_id")
            or meta.get("workspace_id")
            or DEFAULT_TENANT_ID
        )
    except Exception:
        tenant_id = DEFAULT_TENANT_ID

    instructions = _bind_session_database(str(tenant_id))

    # Gemini Live barge-in tuning:
    # - START_SENSITIVITY_HIGH + short prefix padding → stop quickly when the user talks
    # - min_duration ~280ms → ignore brief coughs/noise, still catch real barge-ins
    # - END_SENSITIVITY_LOW → don't cut the user's interrupt utterance short
    # - no backchannel suppression near turn edges
    session = AgentSession(
        turn_handling=TurnHandlingOptions(
            turn_detection="realtime_llm",
            interruption={
                "enabled": True,
                "min_duration": 0.28,
                "min_words": 0,
                "resume_false_interruption": False,
                "false_interruption_timeout": 1.0,
                "backchannel_boundary": None,
            },
        ),
        llm=google.realtime.RealtimeModel(
            model=GEMINI_LIVE_MODEL,
            voice="Kore",
            api_key=API_KEY,
            instructions=instructions,
            realtime_input_config=genai_types.RealtimeInputConfig(
                activity_handling=genai_types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
                automatic_activity_detection=genai_types.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=genai_types.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=genai_types.EndSensitivity.END_SENSITIVITY_LOW,
                    prefix_padding_ms=10,
                    silence_duration_ms=450,
                ),
            ),
        ),
    )

    agent = Agent(
        instructions=instructions,
        tools=[*DB_FAST_PATH_TOOLS, run_custom_read_query, *TICKET_TOOLS, search_documents],
    )

    def _on_data_received(data: rtc.DataPacket) -> None:
        """UI interrupt button / explicit barge-in signal from the browser client."""
        try:
            msg = json.loads(data.data.decode("utf-8"))
        except Exception:
            return
        if not isinstance(msg, dict) or msg.get("type") != "interrupt":
            return
        try:
            session.interrupt(force=True)
            logger.info("Interrupted agent speech via client signal")
        except Exception as exc:
            logger.warning("Client interrupt failed: %s", exc)

    ctx.room.on("data_received", _on_data_received)

    _wire_transcript_events(session)
    await session.start(agent=agent, room=ctx.room)
    # gemini-3.1-flash-live-preview rejects generate_reply / mid-session client content.


if __name__ == "__main__":
    cli.run_app(server)
