from __future__ import annotations

from fastapi import APIRouter

from ..services.sql_mcp import sql_mcp_service

router = APIRouter(prefix="/api/sql-mcp", tags=["sql-mcp"])


@router.get("/column-context")
async def column_context(tenantId: str = "default_tenant"):
    return sql_mcp_service.get_column_context(tenantId)


@router.get("/logs")
async def logs():
    return sql_mcp_service.get_logs()


@router.post("/call-tool")
async def call_tool(payload: dict):
    tenant_id = payload.get("tenantId", "default_tenant")
    tool_name = payload.get("toolName")
    args = payload.get("args", {})
    if not tool_name:
        return {"status": "error", "error": "toolName is required"}
    return await sql_mcp_service.call_tool(tenant_id, tool_name, args)


@router.post("/connect-database")
async def connect_database(payload: dict):
    tenant_id = payload.get("tenantId", "default_tenant")
    config = payload.get("config", {})
    return await sql_mcp_service.connect_database(tenant_id, config)
