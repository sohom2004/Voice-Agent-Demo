from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Allow importing sql-mcp from the sibling directory even if it wasn't
# `pip install -e`'d (parents[3] = repo root: services -> app -> backend -> root).
ROOT = Path(__file__).resolve().parents[3]
SQL_MCP_ROOT = ROOT / "sql-mcp"
if str(SQL_MCP_ROOT) not in sys.path:
    sys.path.insert(0, str(SQL_MCP_ROOT))

from sql_mcp.engine import SqlMcpEngine
from sql_mcp.manifest import to_raw_schema
from sql_mcp.models import ConnectionConfig, redact_secrets
from sql_mcp.ticket_workflow import TICKET_TOOL_DEFINITIONS, dispatch_ticket_tool

from ..config import settings
from .connection_registry import (
    clear_persisted_connection,
    get_active_config_for_voice,
    load_persisted_connection,
    save_persisted_connection,
)

# Re-export for voice agent / other importers.
__all__ = [
    "SqlMcpService",
    "sql_mcp_service",
    "resolve_tenant_id",
    "load_persisted_connection",
    "get_active_config_for_voice",
    "RUN_CUSTOM_READ_QUERY",
]

RUN_CUSTOM_READ_QUERY = "run_custom_read_query"
TICKET_TOOL_NAMES = {t["name"] for t in TICKET_TOOL_DEFINITIONS}


def resolve_tenant_id(
    *sources: dict[str, Any] | None,
    default: str = "default_tenant",
    explicit: str | None = None,
) -> str:
    """Accept workspaceId or tenantId from query/body/config."""
    if explicit:
        return str(explicit)
    for source in sources:
        if not source:
            continue
        value = (
            source.get("tenantId")
            or source.get("tenant_id")
            or source.get("workspaceId")
            or source.get("workspace_id")
        )
        if value:
            return str(value)
    return default


class SqlMcpService:
    def __init__(self) -> None:
        self._engines: dict[str, SqlMcpEngine] = {}
        self._active_configs: dict[str, ConnectionConfig] = {}
        self._explicitly_disconnected: set[str] = set()
        self._logs: list[dict] = []
        self._lock = asyncio.Lock()

    def _default_config(self, tenant_id: str) -> ConnectionConfig:
        return ConnectionConfig(
            tenant_id=tenant_id,
            dialect=settings.sql_mcp_dialect,  # type: ignore[arg-type]
            host=settings.sql_mcp_host,
            port=settings.sql_mcp_port,
            user=settings.sql_mcp_user,
            password=settings.sql_mcp_password,
            database=settings.sql_mcp_database,
        )

    def _config_from_payload(self, tenant_id: str, config: dict[str, Any] | None) -> ConnectionConfig:
        return ConnectionConfig.from_dict({**(config or {}), "tenantId": tenant_id})

    def get_engine(self, tenant_id: str = "default_tenant") -> SqlMcpEngine:
        """Return the active engine for a workspace.

        Resolution order:
        1. In-memory registry
        2. Server-local persisted connection (unless explicitly disconnected)
        3. Env-var default config (backward compatible)
        """
        if tenant_id in self._engines:
            return self._engines[tenant_id]

        if tenant_id not in self._explicitly_disconnected:
            persisted = load_persisted_connection(tenant_id)
            if persisted is not None:
                engine = SqlMcpEngine(persisted)
                # Setup path only: compile once and cache on the engine.
                engine.compile_manifest()
                self._engines[tenant_id] = engine
                self._active_configs[tenant_id] = persisted
                return engine

        # Env-var fallback — not treated as a dynamically "connected" workspace
        # unless/until connect_database is called.
        engine = SqlMcpEngine(self._default_config(tenant_id))
        self._engines[tenant_id] = engine
        return engine

    def log(self, event_type: str, message: str, details: dict | None = None) -> None:
        entry = {
            "id": f"log-{len(self._logs)}",
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "type": event_type,
            "source": "sql_mcp",
            "message": message,
            "details": redact_secrets(details or {}),
        }
        self._logs.insert(0, entry)
        self._logs = self._logs[:500]

    def get_logs(self) -> list[dict]:
        return self._logs

    async def test_connection(
        self,
        config: dict[str, Any],
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        """Probe a connection with a temporary engine — does not replace the active one."""
        resolved = resolve_tenant_id(config, explicit=tenant_id)
        try:
            connection = self._config_from_payload(resolved, config)
        except (TypeError, ValueError) as exc:
            return {
                "ok": False,
                "connected": False,
                "error": str(exc),
                "connection": redact_secrets({**(config or {}), "tenantId": resolved}),
            }

        engine = SqlMcpEngine(connection)
        try:
            probe = engine.test_connection()
            if probe.get("status") == "error":
                raise RuntimeError(probe.get("error") or "Connection test failed")
            tables = probe.get("tables") or []
            self.log(
                "DB_TEST",
                f"Connection test ok for tenant {resolved}",
                {"tableCount": len(tables), "dialect": connection.dialect},
            )
            return {
                "ok": True,
                "connected": True,
                "tenantId": resolved,
                "workspaceId": resolved,
                "tableCount": len(tables),
                "tables": tables,
                "dialect": connection.dialect,
                "database": connection.database,
                "connection": connection.redacted_dict(),
            }
        except Exception as exc:
            self.log(
                "DB_TEST",
                f"Connection test failed for tenant {resolved}: {exc}",
                {"error": str(exc)},
            )
            return {
                "ok": False,
                "connected": False,
                "tenantId": resolved,
                "workspaceId": resolved,
                "error": str(exc),
                "connection": connection.redacted_dict(),
            }
        finally:
            engine.close()

    async def connect_database(self, tenant_id: str, config: dict) -> dict:
        async with self._lock:
            try:
                connection = self._config_from_payload(tenant_id, config)
            except (TypeError, ValueError) as exc:
                return {"tenantId": tenant_id, "error": str(exc), "tables": [], "tools": []}

            engine = SqlMcpEngine(connection)
            try:
                # Setup path: verify connectivity, then compile manifest once.
                probe = engine.test_connection()
                if probe.get("status") == "error":
                    raise RuntimeError(probe.get("error") or "Connection test failed")
                engine.compile_manifest()
            except Exception as exc:
                engine.close()
                self.log(
                    "DB_INTROSPECTION",
                    f"Failed to connect database for tenant {tenant_id}: {exc}",
                    {"error": str(exc), "config": connection.redacted_dict()},
                )
                return {
                    "tenantId": tenant_id,
                    "error": str(exc),
                    "tables": [],
                    "tools": [],
                    "connection": connection.redacted_dict(),
                }

            # Replace any previous engine for this workspace.
            previous = self._engines.pop(tenant_id, None)
            if previous is not None:
                previous.close()
            self._engines[tenant_id] = engine
            self._active_configs[tenant_id] = connection
            self._explicitly_disconnected.discard(tenant_id)
            save_persisted_connection(connection)

            self.log(
                "DB_INTROSPECTION",
                f"Connected database for tenant {tenant_id}",
                connection.redacted_dict(),
            )
            ctx = self.get_column_context(tenant_id)
            ctx["connection"] = connection.redacted_dict()
            return ctx

    async def disconnect_database(self, tenant_id: str) -> dict[str, Any]:
        async with self._lock:
            engine = self._engines.pop(tenant_id, None)
            self._active_configs.pop(tenant_id, None)
            self._explicitly_disconnected.add(tenant_id)
            clear_persisted_connection(tenant_id)

            # Engines may hold a pooled connection — close it explicitly.
            if engine is not None:
                engine.close()

            self.log("DB_DISCONNECT", f"Disconnected database for tenant {tenant_id}")
            return {
                "ok": True,
                "connected": False,
                "tenantId": tenant_id,
                "workspaceId": tenant_id,
                "status": "disconnected",
            }

    async def refresh_schema(self, tenant_id: str) -> dict:
        """Force recompile of the tool manifest (setup path only)."""
        async with self._lock:
            if tenant_id in self._explicitly_disconnected and tenant_id not in self._active_configs:
                # Still allow refresh against env-default / persisted hydrate via get_engine
                # only if we have an in-memory or persisted active connection.
                if load_persisted_connection(tenant_id) is None and tenant_id not in self._engines:
                    return {
                        "tenantId": tenant_id,
                        "error": "No active database connection for this workspace",
                        "tables": [],
                        "tools": [],
                    }

            engine = self.get_engine(tenant_id)
            try:
                engine.compile_manifest(force=True)
            except Exception as exc:
                self.log(
                    "DB_INTROSPECTION",
                    f"Schema refresh failed for tenant {tenant_id}: {exc}",
                    {"error": str(exc)},
                )
                return {"tenantId": tenant_id, "error": str(exc), "tables": [], "tools": []}

            self.log("DB_INTROSPECTION", f"Schema refreshed for tenant {tenant_id}")
            return self.get_column_context(tenant_id)

    def get_connection_status(self, tenant_id: str = "default_tenant") -> dict[str, Any]:
        config = self._active_configs.get(tenant_id)
        engine = self._engines.get(tenant_id)

        if config is None and tenant_id not in self._explicitly_disconnected:
            config = load_persisted_connection(tenant_id)

        dynamically_connected = config is not None and tenant_id not in self._explicitly_disconnected

        if dynamically_connected and engine is None:
            try:
                engine = self.get_engine(tenant_id)
            except Exception as exc:
                return {
                    "connected": False,
                    "tenantId": tenant_id,
                    "workspaceId": tenant_id,
                    "error": str(exc),
                    "connection": config.redacted_dict() if config else None,
                }

        if not dynamically_connected:
            # Env-default engines may exist for chat fallback; report disconnected
            # for the dynamic connection surface.
            fallback = self._default_config(tenant_id)
            return {
                "connected": False,
                "tenantId": tenant_id,
                "workspaceId": tenant_id,
                "status": "disconnected",
                "dialect": fallback.dialect,
                "database": fallback.database,
                "schemaHash": None,
                "tableCount": 0,
                "toolCount": 0,
                "connection": None,
                "envDefaultAvailable": True,
            }

        assert config is not None
        schema_hash = None
        table_count = 0
        tool_count = 0
        if engine is not None:
            manifest = engine.get_manifest()
            if manifest is None:
                # Status should not force a full re-introspect when never compiled;
                # compile once (setup) so we can report hash/counts.
                try:
                    manifest = engine.compile_manifest()
                except Exception as exc:
                    return {
                        "connected": True,
                        "tenantId": tenant_id,
                        "workspaceId": tenant_id,
                        "status": "connected",
                        "dialect": config.dialect,
                        "database": config.database,
                        "schemaHash": None,
                        "tableCount": 0,
                        "toolCount": 0,
                        "connection": config.redacted_dict(),
                        "error": str(exc),
                    }
            schema_hash = manifest.schema_hash
            table_count = len({t.table for t in manifest.tools})
            # Match get_column_context tool surface without recompiling.
            tool_count = len(manifest.tools) + 1  # + run_custom_read_query
            if self._include_ticket_tools(engine):
                tool_count += len(TICKET_TOOL_DEFINITIONS)

        return {
            "connected": True,
            "tenantId": tenant_id,
            "workspaceId": tenant_id,
            "status": "connected",
            "dialect": config.dialect,
            "database": config.database,
            "schemaHash": schema_hash,
            "tableCount": table_count,
            "toolCount": tool_count,
            "connection": config.redacted_dict(),
        }

    def _include_ticket_tools(self, engine: SqlMcpEngine) -> bool:
        return engine.config.dialect == "sqlite"

    def _manifest_tool_defs(self, engine: SqlMcpEngine) -> list[dict]:
        """Compiled fast-path tools in {name, description, input_schema} shape.

        Uses the engine-cached manifest when present so the hot path does not
        re-introspect. Compiles once if the manifest is missing.
        """
        manifest = engine.get_manifest()
        if manifest is None:
            manifest = engine.compile_manifest()
        tools = [
            {
                "name": raw["name"],
                "description": raw["description"],
                "input_schema": raw["parameters"],
            }
            for raw in (to_raw_schema(t) for t in manifest.tools)
        ]
        tools.append(
            {
                "name": RUN_CUSTOM_READ_QUERY,
                "description": (
                    "LAST RESORT: run a read-only SQL SELECT for analytics or joins "
                    "that none of the specific tools above can express. Prefer a "
                    "specific tool whenever one fits."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {"sql": {"type": "string"}},
                    "required": ["sql"],
                },
            }
        )
        if self._include_ticket_tools(engine):
            for ticket_tool in TICKET_TOOL_DEFINITIONS:
                tools.append(
                    {
                        "name": ticket_tool["name"],
                        "description": ticket_tool["description"],
                        "input_schema": ticket_tool["parameters"],
                    }
                )
        return tools

    def get_column_context(self, tenant_id: str = "default_tenant") -> dict:
        try:
            engine = self.get_engine(tenant_id)
            snapshot = engine.get_schema_snapshot()
            tools = self._manifest_tool_defs(engine)
            return {
                "tenantId": tenant_id,
                "workspaceId": tenant_id,
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
            return {
                "tenantId": tenant_id,
                "workspaceId": tenant_id,
                "error": str(exc),
                "tables": [],
                "tools": [],
            }

    async def call_tool(self, tenant_id: str, tool_name: str, args: dict) -> dict:
        # Hot path: reuse existing engine — no reconnect, no forced recompile.
        engine = self.get_engine(tenant_id)
        self.log("TOOL_CALL", f"Tool call: {tool_name}", {"args": args})
        if tool_name == RUN_CUSTOM_READ_QUERY:
            result = engine.execute_read(args.get("sql", ""))
        elif tool_name in TICKET_TOOL_NAMES:
            if engine.config.dialect != "sqlite":
                result = {
                    "status": "error",
                    "error": (
                        "Ticket tools require a SQLite database connection "
                        f"(current dialect: {engine.config.dialect})."
                    ),
                }
            else:
                result = dispatch_ticket_tool(engine.config.database, tool_name, args)
        else:
            # call_manifest_tool compiles only if manifest is missing.
            result = engine.call_manifest_tool(tool_name, args)
        self.log("GUARDRAIL_CHECK", f"{tool_name} -> {result.get('status')}", result)
        return result

    async def call_ticket_tool(self, tenant_id: str, tool_name: str, args: dict) -> dict:
        return await self.call_tool(tenant_id, tool_name, args)

    def get_gemini_tools(self, tenant_id: str = "default_tenant") -> list[dict]:
        engine = self.get_engine(tenant_id)
        tools = []
        for item in self._manifest_tool_defs(engine):
            tools.append(
                {
                    "name": item["name"],
                    "description": item["description"],
                    "parameters": item["input_schema"],
                }
            )
        return tools

    def get_schema_prompt_summary(self, tenant_id: str = "default_tenant") -> str:
        from sql_mcp.manifest import describe_manifest_for_prompt

        engine = self.get_engine(tenant_id)
        manifest = engine.compile_manifest()
        snapshot = engine.get_schema_snapshot()
        return describe_manifest_for_prompt(manifest, snapshot)


sql_mcp_service = SqlMcpService()
