from __future__ import annotations

from fastapi import APIRouter

from ..services.sql_mcp import resolve_tenant_id, sql_mcp_service

router = APIRouter(prefix="/api/sql-mcp", tags=["sql-mcp"])


@router.get("/column-context")
async def column_context(tenantId: str | None = None, workspaceId: str | None = None):
    tenant_id = resolve_tenant_id(explicit=tenantId or workspaceId)
    return sql_mcp_service.get_column_context(tenant_id)


@router.get("/logs")
async def logs():
    return sql_mcp_service.get_logs()


@router.get("/connection-status")
async def connection_status(tenantId: str | None = None, workspaceId: str | None = None):
    tenant_id = resolve_tenant_id(explicit=tenantId or workspaceId)
    return sql_mcp_service.get_connection_status(tenant_id)


@router.post("/call-tool")
async def call_tool(payload: dict):
    tenant_id = resolve_tenant_id(payload)
    tool_name = payload.get("toolName")
    args = payload.get("args", {})
    if not tool_name:
        return {"status": "error", "error": "toolName is required"}
    return await sql_mcp_service.call_tool(tenant_id, tool_name, args)


@router.post("/test-connection")
async def test_connection(payload: dict):
    config = payload.get("config") or {
        k: v for k, v in payload.items() if k not in {"tenantId", "workspaceId", "tenant_id", "workspace_id", "config"}
    }
    tenant_id = resolve_tenant_id(payload, config if isinstance(config, dict) else None)
    if not isinstance(config, dict) or not config:
        return {"ok": False, "connected": False, "error": "config is required"}
    return await sql_mcp_service.test_connection(config, tenant_id=tenant_id)


@router.post("/connect-database")
async def connect_database(payload: dict):
    config = payload.get("config", {})
    tenant_id = resolve_tenant_id(payload, config if isinstance(config, dict) else None)
    if not isinstance(config, dict):
        config = {}
    return await sql_mcp_service.connect_database(tenant_id, config)


@router.post("/disconnect-database")
async def disconnect_database(payload: dict | None = None):
    body = payload or {}
    tenant_id = resolve_tenant_id(body)
    return await sql_mcp_service.disconnect_database(tenant_id)


@router.post("/refresh-schema")
async def refresh_schema(payload: dict | None = None):
    body = payload or {}
    tenant_id = resolve_tenant_id(body)
    return await sql_mcp_service.refresh_schema(tenant_id)
