#!/usr/bin/env python3
"""Migrate the medical-billing SQLite demo database into PostgreSQL.

Safe by default: never drops existing production business data.

Usage:
  python scripts/migrate_sqlite_to_postgres.py
  python scripts/migrate_sqlite_to_postgres.py --verify
  python scripts/migrate_sqlite_to_postgres.py --reset   # destructive, explicit

Environment:
  DATABASE_URL or SQL_MCP_DATABASE_URL (preferred)
  or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE
  SQL_MCP_SCHEMA (default: business)
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sql-mcp"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

from sql_mcp.business_schema import (  # noqa: E402
    BUSINESS_TABLES,
    INSERT_ORDER,
    PK_COLUMNS,
    rag_schema_ddl,
    schema_ddl,
)
from sql_mcp.demo_billing import initialize_demo_database  # noqa: E402
from sql_mcp.models import ConnectionConfig, postgres_dsn  # noqa: E402

EXPECTED_SEED_COUNTS = {
    "customers": 20,
    "billing_accounts": 20,
    "claims": 40,
    "invoices": 30,
    "payments": 40,
    "claim_adjustments": 25,
    "tickets": 20,
    "ticket_comments": 35,
}


def _exec_script(cur, sql: str) -> None:
    for stmt in sql.split(";"):
        stmt = stmt.strip()
        if stmt:
            cur.execute(stmt)


def _pg_connect(cfg: ConnectionConfig):
    import psycopg2
    from psycopg2.extras import RealDictCursor

    if cfg.connection_url:
        return psycopg2.connect(postgres_dsn(cfg.connection_url), cursor_factory=RealDictCursor)
    return psycopg2.connect(
        host=cfg.host,
        port=cfg.port,
        user=cfg.user,
        password=cfg.password or None,
        dbname=cfg.database,
        cursor_factory=RealDictCursor,
    )


def _sqlite_connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _sqlite_tables(conn: sqlite3.Connection) -> list[str]:
    cur = conn.cursor()
    cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    return [r[0] for r in cur.fetchall()]


def _count(conn, table: str, schema: str | None = None) -> int:
    cur = conn.cursor()
    if schema:
        cur.execute(f'SELECT COUNT(*) AS n FROM "{schema}"."{table}"')
        row = cur.fetchone()
        return int(row["n"] if isinstance(row, dict) else row[0])
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    row = cur.fetchone()
    return int(row[0] if not isinstance(row, dict) else row["count"] if "count" in row else list(row.values())[0])


def sqlite_counts(path: Path) -> dict[str, int]:
    conn = _sqlite_connect(path)
    try:
        tables = _sqlite_tables(conn)
        return {t: _count(conn, t) for t in tables}
    finally:
        conn.close()


def postgres_counts(pg, schema: str) -> dict[str, int]:
    cur = pg.cursor()
    cur.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = %s AND table_type = 'BASE TABLE'
        ORDER BY table_name
        """,
        (schema,),
    )
    tables = [r["table_name"] for r in cur.fetchall()]
    return {t: _count(pg, t, schema) for t in tables}


def _table_exists(pg, schema: str, table: str) -> bool:
    cur = pg.cursor()
    cur.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = %s AND table_name = %s AND table_type = 'BASE TABLE'
        """,
        (schema, table),
    )
    return cur.fetchone() is not None


def verify(sqlite_path: Path, pg, schema: str) -> dict[str, Any]:
    src = sqlite_counts(sqlite_path)
    dst = postgres_counts(pg, schema)
    report: dict[str, Any] = {"ok": True, "tables": {}, "errors": []}
    for table in BUSINESS_TABLES:
        left = src.get(table)
        right = dst.get(table)
        match = left is not None and left == right
        report["tables"][table] = {"sqlite": left, "postgres": right, "ok": match}
        if not match:
            report["ok"] = False
            report["errors"].append(f"{table}: sqlite={left} postgres={right}")

    extra_src = sorted(set(src) - set(BUSINESS_TABLES) - {"sqlite_sequence"})
    extra_dst = sorted(set(dst) - set(BUSINESS_TABLES))
    if extra_src:
        report["errors"].append(f"unexpected sqlite tables: {extra_src}")
        report["ok"] = False
    if extra_dst:
        report["warnings"] = [f"extra postgres business tables: {extra_dst}"]

    cur = pg.cursor()
    cur.execute(
        f"""
        SELECT COUNT(*) AS n FROM (
          SELECT {PK_COLUMNS['customers']}
          FROM "{schema}".customers
          GROUP BY 1 HAVING COUNT(*) > 1
        ) d
        """
    )
    if int(cur.fetchone()["n"]) != 0:
        report["ok"] = False
        report["errors"].append("customers primary key is not unique")

    cur.execute(
        f"""
        SELECT COUNT(*) AS n
        FROM "{schema}".billing_accounts ba
        LEFT JOIN "{schema}".customers c ON c.customer_id = ba.customer_id
        WHERE c.customer_id IS NULL
        """
    )
    orphan = int(cur.fetchone()["n"])
    if orphan:
        report["ok"] = False
        report["errors"].append(f"{orphan} billing_accounts rows missing customers")

    # Representative records
    cur.execute(
        f"""SELECT first_name, last_name, account_number FROM "{schema}".customers WHERE customer_id = 1"""
    )
    row = cur.fetchone()
    if not row or row["first_name"] != "John" or row["account_number"] != "BA10001":
        report["ok"] = False
        report["errors"].append("customer 1 sample mismatch")

    cur.execute(
        f"""SELECT amount_due, status FROM "{schema}".invoices WHERE invoice_number = 'INV10001'"""
    )
    inv = cur.fetchone()
    if not inv or float(inv["amount_due"]) != 150.0:
        report["ok"] = False
        report["errors"].append("invoice INV10001 monetary mismatch")

    return report


def print_report(report: dict[str, Any]) -> None:
    for table, info in report["tables"].items():
        mark = "OK" if info["ok"] else "FAIL"
        print(f"{table}: {info['sqlite']} -> {info['postgres']} {mark}")
    for err in report.get("errors") or []:
        print(f"ERROR: {err}")
    for warn in report.get("warnings") or []:
        print(f"WARN: {warn}")


def _copy_table(sqlite_conn: sqlite3.Connection, pg, schema: str, table: str) -> int:
    src = sqlite_conn.cursor()
    src.execute(f"SELECT * FROM {table}")
    rows = src.fetchall()
    if not rows:
        return 0
    columns = [d[0] for d in src.description]
    col_sql = ", ".join(f'"{c}"' for c in columns)
    placeholders = ", ".join(["%s"] * len(columns))
    cur = pg.cursor()
    cur.executemany(
        f'INSERT INTO "{schema}"."{table}" ({col_sql}) VALUES ({placeholders})',
        [tuple(row[c] for c in columns) for row in rows],
    )
    return len(rows)


def _reset_identity(pg, schema: str) -> None:
    cur = pg.cursor()
    for table, pk in PK_COLUMNS.items():
        cur.execute(
            "SELECT pg_get_serial_sequence(%s, %s)",
            (f"{schema}.{table}", pk),
        )
        row = cur.fetchone()
        seq = row["pg_get_serial_sequence"] if isinstance(row, dict) else row[0]
        if not seq:
            continue
        cur.execute(
            f'SELECT COALESCE(MAX("{pk}"), 1) AS m FROM "{schema}"."{table}"'
        )
        max_id = int(cur.fetchone()["m"])
        cur.execute("SELECT setval(%s, %s, true)", (seq, max_id))


def migrate(
    sqlite_path: Path,
    cfg: ConnectionConfig,
    schema: str,
    *,
    reset: bool,
    init_rag: bool,
) -> dict[str, Any]:
    if not sqlite_path.exists():
        print(f"SQLite source missing at {sqlite_path}; creating seed database.")
        initialize_demo_database(sqlite_path, overwrite=False)

    pg = _pg_connect(cfg)
    pg.autocommit = False
    try:
        cur = pg.cursor()
        if init_rag:
            _exec_script(cur, rag_schema_ddl())

        existing = postgres_counts(pg, schema) if _schema_exists(pg, schema) else {}
        populated = any(existing.get(t, 0) > 0 for t in BUSINESS_TABLES)

        if populated and not reset:
            report = verify(sqlite_path, pg, schema)
            print("Business schema already present; leaving existing data untouched.")
            print_report(report)
            if not report["ok"]:
                print(
                    "NOTE: row counts differ from SQLite (runtime writes are expected). "
                    "Use --reset only to rebuild the business schema from the seed file."
                )
            pg.commit()
            return report

        if reset:
            cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')

        _exec_script(cur, schema_ddl(schema))

        sqlite_conn = _sqlite_connect(sqlite_path)
        try:
            src_tables = set(_sqlite_tables(sqlite_conn))
            missing = [t for t in BUSINESS_TABLES if t not in src_tables]
            if missing:
                raise SystemExit(f"SQLite source is missing required tables: {missing}")
            extra = sorted(src_tables - set(BUSINESS_TABLES) - {"sqlite_sequence"})
            if extra:
                raise SystemExit(f"SQLite source has unexpected tables not in the migrator: {extra}")

            for table in INSERT_ORDER:
                copied = _copy_table(sqlite_conn, pg, schema, table)
                print(f"  copied {table}: {copied}")
            _reset_identity(pg, schema)
            pg.commit()
            report = verify(sqlite_path, pg, schema)
        finally:
            sqlite_conn.close()

        print_report(report)
        if not report["ok"]:
            raise SystemExit("Migration verification failed.")
        return report
    except Exception:
        pg.rollback()
        raise
    finally:
        pg.close()


def _schema_exists(pg, schema: str) -> bool:
    cur = pg.cursor()
    cur.execute("SELECT 1 FROM information_schema.schemata WHERE schema_name = %s", (schema,))
    return cur.fetchone() is not None


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate demo SQLite business data to PostgreSQL")
    parser.add_argument(
        "--sqlite",
        default=str(ROOT / "demo_database.db"),
        help="Path to demo_database.db (seed source)",
    )
    parser.add_argument("--schema", default=os.getenv("SQL_MCP_SCHEMA", "business"))
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop and recreate the business schema. Never the default.",
    )
    parser.add_argument("--verify", action="store_true", help="Compare SQLite vs PostgreSQL only")
    parser.add_argument(
        "--init-rag",
        action="store_true",
        help="Also create public documents / document_chunks tables if missing",
    )
    args = parser.parse_args()

    sqlite_path = Path(args.sqlite)
    if not sqlite_path.is_absolute():
        sqlite_path = (ROOT / sqlite_path).resolve()

    cfg = ConnectionConfig.from_env()
    if cfg.dialect != "postgres":
        print("ERROR: PostgreSQL connection required. Set DATABASE_URL.", file=sys.stderr)
        return 1

    schema = args.schema
    if args.verify:
        pg = _pg_connect(cfg)
        try:
            report = verify(sqlite_path, pg, schema)
            print_report(report)
            return 0 if report["ok"] else 1
        finally:
            pg.close()

    print(f"Migrating {sqlite_path} -> {cfg.database} schema={schema} reset={args.reset}")
    report = migrate(sqlite_path, cfg, schema, reset=args.reset, init_rag=args.init_rag)
    if report.get("ok"):
        print("Migration verified.")
        return 0
    print("Existing PostgreSQL business data was left unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
