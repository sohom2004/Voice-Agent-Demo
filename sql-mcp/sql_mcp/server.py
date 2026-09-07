"""stdio MCP server entrypoint for sql-mcp."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .engine import SqlMcpEngine
from .models import ConnectionConfig

server = Server("sql-mcp")
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


def _tool_defs() -> list[Tool]:
    return [
        Tool(
            name=item["name"],
            description=item["description"],
            inputSchema=item["input_schema"],
        )
        for item in engine.get_tool_definitions()
    ]


@server.list_tools()
async def list_tools() -> list[Tool]:
    return _tool_defs()


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any] | None) -> list[TextContent]:
    result = engine.call_tool(name, arguments or {})
    return [TextContent(type="text", text=json.dumps(result, default=str))]


async def main() -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
