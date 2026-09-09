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
for pkg_root in (SQL_MCP_ROOT, DOC_RETRIEVAL_ROOT):
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


def _resolve_db_path(raw: str) -> str:
    path = Path(raw or "demo_database.db")
    if not path.is_absolute():
        path = (ROOT / path).resolve()
    return str(path)


# ---------------------------------------------------------------------------
# Database: compiled fast-path tools (schema introspected once at startup).
# ---------------------------------------------------------------------------

_db_path = _resolve_db_path(os.getenv("SQL_MCP_DATABASE", "demo_database.db"))
engine = SqlMcpEngine(
    ConnectionConfig(
        tenant_id=os.getenv("SQL_MCP_TENANT_ID", "default_tenant"),
        dialect=os.getenv("SQL_MCP_DIALECT", "sqlite"),
        host=os.getenv("SQL_MCP_HOST", "localhost"),
        port=int(os.getenv("SQL_MCP_PORT", "5432")),
        user=os.getenv("SQL_MCP_USER", "postgres"),
        password=os.getenv("SQL_MCP_PASSWORD", "postgres"),
        database=_db_path,
    )
)

_manifest = engine.compile_manifest()
_schema_snapshot = engine.get_schema_snapshot()
_DB_SCHEMA_SUMMARY = describe_manifest_for_prompt(_manifest, _schema_snapshot)

logger.info(
    "Compiled %d fast-path database tool(s) from %d table(s): %s",
    len(_manifest.tools),
    len(_schema_snapshot.tables),
    ", ".join(t.name for t in _manifest.tools),
)


def _make_fast_path_tool(tool_name: str):
    """Build one LiveKit tool for a single compiled manifest tool."""

    async def _handler(raw_arguments: dict[str, Any]) -> str:
        result = engine.call_manifest_tool(tool_name, raw_arguments)
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
    return json.dumps(engine.execute_read(sql), default=str)


def _make_ticket_tool(tool_def: dict[str, Any]):
    tool_name = tool_def["name"]

    async def _handler(raw_arguments: dict[str, Any]) -> str:
        result = dispatch_ticket_tool(_db_path, tool_name, raw_arguments or {})
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
    # Fresh lookup each tool call so recent uploads are visible without waiting
    # out the short in-memory cache TTL.
    doc_engine.invalidate()
    if not doc_engine.has_any_documents():
        return "No documents have been uploaded yet."
    results = doc_engine.search(query, top_k=5)
    if not results:
        return "Nothing relevant was found in the uploaded documents."
    return doc_engine.format_context(results)


INSTRUCTIONS = build_system_prompt(_DB_SCHEMA_SUMMARY)

server = AgentServer()


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    await ctx.connect()

    if not API_KEY:
        raise RuntimeError("GEMINI_API_KEY or GOOGLE_API_KEY is required for Gemini Live.")

    # Gemini Live barge-in: start-of-speech interrupts the model immediately.
    # Keep silence_duration modest so end-of-turn stays snappy (no added latency).
    session = AgentSession(
        turn_handling=TurnHandlingOptions(
            turn_detection="realtime_llm",
            interruption={
                "enabled": True,
                "min_duration": 0.2,
                "resume_false_interruption": False,
            },
        ),
        llm=google.realtime.RealtimeModel(
            model=GEMINI_LIVE_MODEL,
            voice="Kore",
            api_key=API_KEY,
            instructions=INSTRUCTIONS,
            realtime_input_config=genai_types.RealtimeInputConfig(
                activity_handling=genai_types.ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
                automatic_activity_detection=genai_types.AutomaticActivityDetection(
                    disabled=False,
                    start_of_speech_sensitivity=genai_types.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=genai_types.EndSensitivity.END_SENSITIVITY_HIGH,
                    prefix_padding_ms=20,
                    silence_duration_ms=400,
                ),
            ),
        ),
    )

    agent = Agent(
        instructions=INSTRUCTIONS,
        tools=[*DB_FAST_PATH_TOOLS, run_custom_read_query, *TICKET_TOOLS, search_documents],
    )

    await session.start(agent=agent, room=ctx.room)
    # gemini-3.1-flash-live-preview rejects generate_reply / mid-session client content.


if __name__ == "__main__":
    cli.run_app(server)
