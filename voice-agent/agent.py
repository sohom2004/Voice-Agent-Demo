from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, cli, function_tool
from livekit.plugins import google, silero

ROOT = Path(__file__).resolve().parents[1]
SQL_MCP_ROOT = ROOT / "sql-mcp"
if str(SQL_MCP_ROOT) not in sys.path:
    sys.path.insert(0, str(SQL_MCP_ROOT))

from sql_mcp.engine import SqlMcpEngine
from sql_mcp.models import ConnectionConfig

load_dotenv(ROOT / ".env")

engine = SqlMcpEngine(
    ConnectionConfig(
        tenant_id=os.getenv("SQL_MCP_TENANT_ID", "default_tenant"),
        dialect=os.getenv("SQL_MCP_DIALECT", "sqlite"),
        host=os.getenv("SQL_MCP_HOST", "localhost"),
        port=int(os.getenv("SQL_MCP_PORT", "5432")),
        user=os.getenv("SQL_MCP_USER", "postgres"),
        password=os.getenv("SQL_MCP_PASSWORD", "postgres"),
        database=os.getenv("SQL_MCP_DATABASE", "demo_database.db"),
    )
)

server = AgentServer()


@function_tool
async def list_tables() -> str:
    """List all tables in the connected database."""
    return json.dumps(engine.call_tool("list_tables", {}))


@function_tool
async def describe_table(table_name: str) -> str:
    """Describe columns for a database table."""
    return json.dumps(engine.call_tool("describe_table", {"table_name": table_name}))


@function_tool
async def execute_read(sql: str) -> str:
    """Run a SELECT query against the database."""
    return json.dumps(engine.call_tool("execute_read", {"sql": sql}))


@function_tool
async def execute_write(sql: str, confirmed: bool = False) -> str:
    """Run INSERT, UPDATE, or DELETE. Set confirmed=true after user approval."""
    return json.dumps(engine.call_tool("execute_write", {"sql": sql, "confirmed": confirmed}))


INSTRUCTIONS = """You are Natasha, a warm multilingual voice assistant.
Help users with database questions and uploaded documents.
Use database tools to look up live data. Speak naturally without markdown or JSON.
Never ask users for table names, SQL, or technical database details.
"""


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=google.STT(),
        llm=google.LLM(model="gemini-2.5-flash"),
        tts=google.TTS(),
    )

    agent = Agent(
        instructions=INSTRUCTIONS,
        tools=[list_tables, describe_table, execute_read, execute_write],
    )

    await session.start(agent=agent, room=ctx.room)
    await session.generate_reply(instructions="Greet the user warmly and offer to help with database or document questions.")


if __name__ == "__main__":
    cli.run_app(server)
