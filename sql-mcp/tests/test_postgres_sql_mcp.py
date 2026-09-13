"""PostgreSQL SQL-MCP + migration tests. Requires a reachable Postgres (DATABASE_URL)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "sql-mcp"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from sql_mcp.business_schema import BUSINESS_TABLES
from sql_mcp.engine import SqlMcpEngine
from sql_mcp.models import ConnectionConfig
from sql_mcp.ticket_workflow import check_ticket, create_ticket, dispatch_ticket_tool, update_ticket


def _pg_config() -> ConnectionConfig:
    os.environ.setdefault("SQL_MCP_SCHEMA", "business")
    cfg = ConnectionConfig.from_env("pg_test")
    if not cfg.connection_url:
        cfg.dialect = "postgres"
        cfg.host = os.getenv("PGHOST", "localhost")
        cfg.port = int(os.getenv("PGPORT", "5432"))
        cfg.user = os.getenv("PGUSER", "postgres")
        cfg.password = os.getenv("PGPASSWORD", "")
        cfg.database = os.getenv("PGDATABASE", "voice_agent")
        cfg.schema_name = "business"
    return cfg


def _can_connect() -> bool:
    cfg = _pg_config()
    if cfg.dialect != "postgres":
        return False
    engine = SqlMcpEngine(cfg)
    try:
        probe = engine.test_connection()
        return probe.get("status") == "ok"
    except Exception:
        return False
    finally:
        engine.close()


pytestmark = pytest.mark.skipif(not _can_connect(), reason="PostgreSQL is not reachable")


@pytest.fixture(scope="module")
def pg_engine() -> SqlMcpEngine:
    cfg = _pg_config()
    engine = SqlMcpEngine(cfg)
    tables = set(engine.list_tables())
    if not set(BUSINESS_TABLES).issubset(tables):
        pytest.skip("business schema is not migrated; run scripts/migrate_sqlite_to_postgres.py")
    engine.compile_manifest()
    yield engine
    engine.close()


def test_postgres_lists_business_tables_not_rag(pg_engine: SqlMcpEngine):
    tables = pg_engine.list_tables()
    assert "customers" in tables
    assert "claims" in tables
    assert "documents" not in tables
    assert "document_chunks" not in tables


def test_postgres_describe_customers(pg_engine: SqlMcpEngine):
    meta = pg_engine.describe_table("customers")
    names = {c.name for c in meta.columns}
    assert "customer_id" in names
    pk = [c for c in meta.columns if c.is_primary_key]
    assert pk and pk[0].name == "customer_id"


def test_postgres_get_customer(pg_engine: SqlMcpEngine):
    result = pg_engine.call_manifest_tool("get_customers_by_id", {"customer_id": 1})
    assert result["status"] == "ok"
    assert result["data"]["first_name"] == "John"
    assert result["data"]["account_number"] == "BA10001"


def test_postgres_get_claim(pg_engine: SqlMcpEngine):
    result = pg_engine.call_manifest_tool("list_claims", {"claim_number": "CLM10002"})
    assert result["status"] == "ok"
    assert result["data"][0]["claim_status"] == "denied"


def test_postgres_get_invoice(pg_engine: SqlMcpEngine):
    result = pg_engine.call_manifest_tool("list_invoices", {"invoice_number": "INV10001"})
    assert result["status"] == "ok"
    assert float(result["data"][0]["amount_due"]) == 150.0


def test_postgres_list_tickets(pg_engine: SqlMcpEngine):
    result = pg_engine.call_manifest_tool("list_tickets", {})
    assert result["status"] == "ok"
    assert result["row_count"] >= 20


def test_postgres_count_records(pg_engine: SqlMcpEngine):
    result = pg_engine.call_manifest_tool("count_customers", {})
    assert result["status"] == "ok"
    assert int(result["data"]["count"]) >= 20


def test_postgres_custom_read_query(pg_engine: SqlMcpEngine):
    result = pg_engine.execute_read(
        "SELECT claim_number FROM claims WHERE claim_number = 'CLM10004'"
    )
    assert result["status"] == "ok"
    assert result["rows"][0]["claim_number"] == "CLM10004"


def test_postgres_crud_roundtrip(pg_engine: SqlMcpEngine):
    created = pg_engine.call_manifest_tool(
        "create_claim_adjustments",
        {
            "claim_id": 1,
            "adjustment_code": "TEST-PG",
            "adjustment_reason": "postgres crud test",
            "adjustment_amount": 1.23,
            "created_at": "2026-03-01 10:00:00",
            "confirmed": True,
        },
    )
    assert created["status"] == "ok", created
    adj_id = created["data"]["adjustment_id"]
    updated = pg_engine.call_manifest_tool(
        "update_claim_adjustments_by_id",
        {"adjustment_id": adj_id, "adjustment_reason": "updated", "confirmed": True},
    )
    assert updated["status"] == "ok"
    assert updated["data"]["adjustment_reason"] == "updated"
    deleted = pg_engine.call_manifest_tool(
        "delete_claim_adjustments_by_id",
        {"adjustment_id": adj_id, "confirmed": True},
    )
    assert deleted["status"] == "ok"


def test_postgres_ticket_tools(pg_engine: SqlMcpEngine):
    checked = check_ticket(pg_engine, "TKT10001", include_recent_comments=True)
    assert checked["status"] == "ok"
    preview = create_ticket(
        pg_engine,
        customer_id=2,
        category="claim_denial",
        subject="PG test",
        description="postgres ticket",
        priority="low",
        confirmed=False,
    )
    assert preview["status"] == "confirmation_required"
    created = create_ticket(
        pg_engine,
        customer_id=2,
        category="claim_denial",
        subject="PG test",
        description="postgres ticket",
        priority="low",
        confirmed=True,
    )
    assert created["status"] == "ok", created
    number = created["data"]["ticket_number"]
    updated = update_ticket(pg_engine, number, comment="noted", confirmed=True)
    assert updated["status"] == "ok"
    unknown = dispatch_ticket_tool(pg_engine, "nope", {})
    assert unknown["status"] == "error"
    tid = int(created["data"]["ticket_id"])
    pg_engine.execute_write(
        "DELETE FROM ticket_comments WHERE ticket_id = %s" if pg_engine.config.dialect == "postgres"
        else "DELETE FROM ticket_comments WHERE ticket_id = ?",
        [tid],
        confirmed=True,
    )
    deleted = pg_engine.call_manifest_tool(
        "delete_tickets_by_id",
        {"ticket_id": tid, "confirmed": True},
    )
    assert deleted["status"] == "ok", deleted


def test_voice_agent_can_bind_postgres_tools(pg_engine: SqlMcpEngine):
    snapshot = pg_engine.get_schema_snapshot()
    names = {t.name for t in pg_engine.compile_manifest().tools}
    assert "get_customers_by_id" in names
    assert "list_claims" in names
    assert pg_engine.has_ticket_tables()
    assert snapshot.dialect == "postgres"
