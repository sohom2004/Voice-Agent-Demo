from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

# Allow importing sql-mcp from sibling directory
ROOT = Path(__file__).resolve().parents[2]
SQL_MCP_ROOT = ROOT / "sql-mcp"
if str(SQL_MCP_ROOT) not in sys.path:
    sys.path.insert(0, str(SQL_MCP_ROOT))

from sql_mcp.engine import SqlMcpEngine
from sql_mcp.models import ConnectionConfig

from ..config import settings


class SqlMcpService:
    def __init__(self) -> None:
        self._engines: dict[str, SqlMcpEngine] = {}
        self._logs: list[dict] = []
        self._lock = asyncio.Lock()

    def _default_config(self, tenant_id: str) -> ConnectionConfig:
        return ConnectionConfig(
            tenant_id=tenant_id,
            dialect=settings.sql_mcp_dialect,
            host=settings.sql_mcp_host,
            port=settings.sql_mcp_port,
            user=settings.sql_mcp_user,
            password=settings.sql_mcp_password,
            database=settings.sql_mcp_database,
        )

    def get_engine(self, tenant_id: str = "default_tenant") -> SqlMcpEngine:
        if tenant_id not in self._engines:
            self._engines[tenant_id] = SqlMcpEngine(self._default_config(tenant_id))
        return self._engines[tenant_id]

    def log(self, event_type: str, message: str, details: dict | None = None) -> None:
        entry = {
            "id": f"log-{len(self._logs)}",
            "timestamp": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "type": event_type,
            "source": "sql_mcp",
            "message": message,
            "details": details or {},
        }
        self._logs.insert(0, entry)
        self._logs = self._logs[:500]

    def get_logs(self) -> list[dict]:
        return self._logs

    async def connect_database(self, tenant_id: str, config: dict) -> dict:
        async with self._lock:
            connection = ConnectionConfig.from_dict({**config, "tenantId": tenant_id})
            engine = SqlMcpEngine(connection)
            self._engines[tenant_id] = engine
            self.log("DB_INTROSPECTION", f"Connected database for tenant {tenant_id}", config)
            return self.get_column_context(tenant_id)

    def get_column_context(self, tenant_id: str = "default_tenant") -> dict:
        try:
            engine = self.get_engine(tenant_id)
            snapshot = engine.get_schema_snapshot()
            tools = engine.get_tool_definitions()
            return {
                "tenantId": tenant_id,
                "dialect": snapshot.dialect,
                "schemaHash": snapshot.schema_hash,
                "fetchedAt": snapshot.fetched_at,
                "tableCount": len(snapshot.tables),
                "tables": [
                    {
                        "name": table.name,
                        "columnCount": len(table.columns),
                        "columns": [
                            {
                                "name": col.name,
                                "dataType": col.data_type,
                                "isNullable": col.is_nullable,
                                "isPrimaryKey": col.is_primary_key,
                                "isForeignKey": col.is_foreign_key,
                                "referencesTable": col.references_table,
                                "referencesColumn": col.references_column,
                            }
                            for col in table.columns
                        ],
                    }
                    for table in snapshot.tables
                ],
                "tools": tools,
            }
        except Exception as exc:
            return {"tenantId": tenant_id, "error": str(exc), "tables": [], "tools": []}

    async def call_tool(self, tenant_id: str, tool_name: str, args: dict) -> dict:
        engine = self.get_engine(tenant_id)
        self.log("TOOL_CALL", f"Tool call: {tool_name}", {"args": args})
        result = engine.call_tool(tool_name, args)
        self.log("GUARDRAIL_CHECK", f"{tool_name} -> {result.get('status')}", result)
        return result

    def get_gemini_tools(self, tenant_id: str = "default_tenant") -> list[dict]:
        engine = self.get_engine(tenant_id)
        tools = []
        for item in engine.get_tool_definitions():
            tools.append(
                {
                    "name": item["name"],
                    "description": item["description"],
                    "parameters": item["input_schema"],
                }
            )
        return tools


sql_mcp_service = SqlMcpService()
