"""Automated tests for the medical-billing BPO demo."""

from __future__ import annotations

import ast
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "sql-mcp"))
sys.path.insert(0, str(ROOT / "doc-retrieval"))

from sql_mcp.demo_billing import REQUIRED_TABLES, initialize_demo_database
from sql_mcp.engine import SqlMcpEngine
from sql_mcp.manifest import describe_manifest_for_prompt
from sql_mcp.models import ConnectionConfig
from sql_mcp.ticket_workflow import (
    TICKET_TOOL_DEFINITIONS,
    check_ticket,
    create_ticket,
    dispatch_ticket_tool,
    update_ticket,
)
from doc_retrieval import DocRetrievalEngine, RetrievalConfig


@pytest.fixture()
def demo_db(tmp_path: Path) -> Path:
    path = tmp_path / "billing_demo.db"
    initialize_demo_database(path, overwrite=True)
    return path


@pytest.fixture()
def engine(demo_db: Path) -> SqlMcpEngine:
    return SqlMcpEngine(
        ConnectionConfig(
            tenant_id="test_tenant",
            dialect="sqlite",
            database=str(demo_db),
        )
    )


def test_database_initialization_and_counts(demo_db: Path):
    conn = sqlite3.connect(str(demo_db))
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        tables = {r[0] for r in cur.fetchall()}
        assert set(REQUIRED_TABLES).issubset(tables)
        assert "patients" not in tables
        assert "lab_results" not in tables

        expected = {
            "customers": 20,
            "billing_accounts": 20,
            "claims": 40,
            "invoices": 30,
            "payments": 40,
            "claim_adjustments": 25,
            "tickets": 20,
            "ticket_comments": 35,
        }
        for table, count in expected.items():
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            assert cur.fetchone()[0] == count, table
    finally:
        conn.close()


def test_foreign_keys_enforced(demo_db: Path):
    conn = sqlite3.connect(str(demo_db))
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO claims (
                  claim_id, billing_account_id, claim_number, service_date, provider_name,
                  procedure_code, billed_amount, insurance_paid, patient_responsibility, claim_status
                ) VALUES (9999, 9999, 'CLM99999', '2026-01-01', 'X', '99213', 1, 0, 0, 'submitted')
                """
            )
            conn.commit()
    finally:
        conn.close()


def test_seeded_customer_retrieval(engine: SqlMcpEngine):
    result = engine.call_manifest_tool("get_customers_by_id", {"customer_id": 1})
    assert result["status"] == "ok"
    assert result["data"]["first_name"] == "John"
    assert result["data"]["last_name"] == "Carter"
    assert result["data"]["account_number"] == "BA10001"


def test_seeded_claim_retrieval(engine: SqlMcpEngine):
    result = engine.call_manifest_tool("list_claims", {"claim_number": "CLM10002"})
    assert result["status"] == "ok"
    assert result["row_count"] == 1
    claim = result["data"][0]
    assert claim["claim_status"] == "denied"
    assert "Prior authorization" in claim["denial_reason"]


def test_seeded_invoice_retrieval(engine: SqlMcpEngine):
    result = engine.call_manifest_tool("list_invoices", {"invoice_number": "INV10001"})
    assert result["status"] == "ok"
    invoice = result["data"][0]
    assert float(invoice["amount_due"]) == 150.0
    assert invoice["status"] == "partially_paid"


def test_seeded_payment_retrieval(engine: SqlMcpEngine):
    result = engine.call_manifest_tool("list_payments", {"payment_reference": "PAY10002"})
    assert result["status"] == "ok"
    payment = result["data"][0]
    assert payment["status"] == "failed"
    assert payment["payment_method"] == "credit_card"


def test_ticket_retrieval(demo_db: Path):
    result = check_ticket(demo_db, "TKT10001", include_recent_comments=True)
    assert result["status"] == "ok"
    data = result["data"]
    assert data["status"] == "in_progress"
    assert data["priority"] == "high"
    assert data["assigned_agent"] == "Rachel Adams"
    assert data["latest_comment"] is not None


def test_ticket_creation_requires_confirmation(demo_db: Path):
    preview = create_ticket(
        demo_db,
        customer_id=2,
        category="claim_denial",
        subject="Need review",
        description="Denied claim follow-up",
        priority="high",
        confirmed=False,
    )
    assert preview["status"] == "confirmation_required"

    created = create_ticket(
        demo_db,
        customer_id=2,
        category="claim_denial",
        subject="Need review",
        description="Denied claim follow-up",
        priority="high",
        confirmed=True,
    )
    assert created["status"] == "ok"
    assert created["data"]["ticket_number"].startswith("TKT")
    assert created["data"]["ticket_number"] != "TKT10001"


def test_ticket_update_and_comments(demo_db: Path):
    preview = update_ticket(
        demo_db,
        "TKT10001",
        comment="Authorization documents submitted.",
        confirmed=False,
    )
    assert preview["status"] == "confirmation_required"

    updated = update_ticket(
        demo_db,
        "TKT10001",
        comment="Authorization documents submitted.",
        confirmed=True,
    )
    assert updated["status"] == "ok"
    assert updated["comment_added"] is True

    checked = check_ticket(demo_db, "TKT10001", include_recent_comments=True)
    assert "Authorization documents submitted." in checked["data"]["latest_comment"]["comment"]


def test_ticket_update_resolved_sets_closed_at(demo_db: Path):
    result = update_ticket(
        demo_db,
        "TKT10002",
        status="resolved",
        resolution="Customer confirmed the explanation.",
        confirmed=True,
    )
    assert result["status"] == "ok"
    assert result["data"]["status"] == "resolved"
    assert result["data"]["closed_at"] is not None


def test_confirmation_gating_for_compiled_writes(engine: SqlMcpEngine):
    preview = engine.call_manifest_tool(
        "update_tickets_by_id",
        {"ticket_id": 1, "priority": "urgent"},
    )
    assert preview["status"] == "confirmation_required"

    applied = engine.call_manifest_tool(
        "update_tickets_by_id",
        {"ticket_id": 1, "priority": "urgent", "confirmed": True},
    )
    assert applied["status"] == "ok"
    assert applied["data"]["priority"] == "urgent"


def test_read_only_custom_sql_restriction(engine: SqlMcpEngine):
    ok = engine.execute_read("SELECT claim_number FROM claims WHERE claim_number = 'CLM10004'")
    assert ok["status"] == "ok"
    assert ok["rows"][0]["claim_number"] == "CLM10004"

    with pytest.raises(ValueError, match="Only SELECT|Forbidden"):
        engine.execute_read("DELETE FROM claims WHERE claim_id = 1")

    write_preview = engine.execute_write("DELETE FROM claims WHERE claim_id = 1", confirmed=False)
    assert write_preview["status"] == "confirmation_required"


def test_manifest_has_no_patient_lab_tables(engine: SqlMcpEngine):
    snapshot = engine.get_schema_snapshot()
    summary = describe_manifest_for_prompt(engine.compile_manifest(), snapshot)
    assert "patients" not in summary.lower()
    assert "lab_results" not in summary.lower()
    for table in REQUIRED_TABLES:
        assert table in summary


def test_document_retrieval_keyword_path(tmp_path: Path):
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir()
    platform_db = upload_dir / "platform.db"
    conn = sqlite3.connect(str(platform_db))
    try:
        conn.execute(
            """
            CREATE TABLE document_chunks (
              id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              document_id TEXT,
              document_name TEXT NOT NULL,
              section_path TEXT,
              chunk_index INT NOT NULL,
              content TEXT NOT NULL,
              metadata TEXT,
              embedding TEXT
            )
            """
        )
        docs_dir = ROOT / "demo-docs"
        for idx, path in enumerate(sorted(docs_dir.glob("*.md"))):
            conn.execute(
                """
                INSERT INTO document_chunks (
                  id, workspace_id, document_id, document_name, section_path,
                  chunk_index, content, metadata, embedding
                ) VALUES (?, 'default_workspace', ?, ?, '[]', 0, ?, '{}', NULL)
                """,
                [f"chunk-{idx}", f"doc-{idx}", path.name, path.read_text()],
            )
        conn.commit()
    finally:
        conn.close()

    engine = DocRetrievalEngine(RetrievalConfig(upload_dir=str(upload_dir), gemini_api_key=""))
    assert engine.has_any_documents()
    results = engine.search("policy for appealing a denied claim", top_k=3)
    assert results
    assert any("appeal" in r.content.lower() or "denied" in r.content.lower() for r in results)


def test_voice_agent_registers_ticket_and_db_tools():
    agent_path = ROOT / "voice-agent" / "agent.py"
    source = agent_path.read_text()
    tree = ast.parse(source)
    assert "TICKET_TOOL_DEFINITIONS" in source
    assert "TICKET_TOOLS" in source
    assert "DB_FAST_PATH_TOOLS" in source
    assert "search_documents" in source
    assert "build_system_prompt" in source
    assert "dispatch_ticket_tool" in source
    assert "*TICKET_TOOLS" in source
    assert isinstance(tree, ast.Module)
    assert {t["name"] for t in TICKET_TOOL_DEFINITIONS} == {
        "check_ticket",
        "create_ticket",
        "update_ticket",
    }


def test_dispatch_ticket_tool_unknown():
    result = dispatch_ticket_tool(":memory:", "nope", {})
    assert result["status"] == "error"
