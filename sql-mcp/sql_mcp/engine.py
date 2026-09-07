from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import ColumnMeta, ConnectionConfig, SchemaSnapshot, TableMeta

READ_ROW_LIMIT = 100
WRITE_ROW_LIMIT = 1

FORBIDDEN_SQL = re.compile(
    r"\b(drop|truncate|alter|create|grant|revoke|copy|execute|call|pragma|attach|detach)\b",
    re.IGNORECASE,
)


class SqlMcpEngine:
    """Deterministic SQL operations with guardrails for MCP and HTTP consumers."""

    def __init__(self, config: ConnectionConfig | None = None):
        self.config = config or ConnectionConfig()
        self._ensure_demo_sqlite()

    def update_connection(self, config: ConnectionConfig) -> None:
        self.config = config
        if config.dialect == "sqlite":
            self._ensure_demo_sqlite()

    def _connect_sqlite(self) -> sqlite3.Connection:
        db_path = Path(self.config.database)
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _connect_postgres(self):
        import psycopg2
        from psycopg2.extras import RealDictCursor

        return psycopg2.connect(
            host=self.config.host,
            port=self.config.port,
            user=self.config.user,
            password=self.config.password,
            dbname=self.config.database,
            cursor_factory=RealDictCursor,
        )

    def _connect(self):
        if self.config.dialect == "sqlite":
            return self._connect_sqlite()
        if self.config.dialect == "postgres":
            return self._connect_postgres()
        raise ValueError(f"Unsupported dialect: {self.config.dialect}")

    def _ensure_demo_sqlite(self) -> None:
        if self.config.dialect != "sqlite":
            return
        db_path = Path(self.config.database)
        if db_path.exists():
            return
        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS patients (
              patient_id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              age INTEGER,
              gender TEXT,
              diagnosis TEXT
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS lab_results (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              patient_id TEXT REFERENCES patients(patient_id),
              test_name TEXT,
              result_value REAL,
              unit TEXT,
              test_date TEXT
            )
            """
        )
        cur.executemany(
            "INSERT OR IGNORE INTO patients VALUES (?, ?, ?, ?, ?)",
            [
                ("P101", "Alice Smith", 34, "Female", "Hypertension"),
                ("P102", "Bob Jones", 58, "Male", "Type 2 Diabetes"),
                ("P103", "Charlie Brown", 45, "Male", "Hyperlipidemia"),
            ],
        )
        cur.executemany(
            "INSERT INTO lab_results (patient_id, test_name, result_value, unit, test_date) VALUES (?, ?, ?, ?, ?)",
            [
                ("P101", "Blood Pressure Systolic", 138.0, "mmHg", "2026-08-15"),
                ("P101", "Cholesterol Total", 210.0, "mg/dL", "2026-08-15"),
                ("P102", "HbA1c", 7.8, "%", "2026-08-20"),
                ("P102", "Fasting Glucose", 145.0, "mg/dL", "2026-08-20"),
            ],
        )
        conn.commit()
        conn.close()

    def _rows_to_dicts(self, rows: list[Any]) -> list[dict[str, Any]]:
        if not rows:
            return []
        first = rows[0]
        if isinstance(first, sqlite3.Row):
            return [dict(row) for row in rows]
        if isinstance(first, dict):
            return rows
        return [dict(row) for row in rows]

    def list_tables(self) -> list[str]:
        conn = self._connect()
        try:
            cur = conn.cursor()
            if self.config.dialect == "sqlite":
                cur.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )
                return [row[0] for row in cur.fetchall()]
            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            )
            return [row["table_name"] for row in cur.fetchall()]
        finally:
            conn.close()

    def describe_table(self, table_name: str) -> TableMeta:
        conn = self._connect()
        try:
            cur = conn.cursor()
            columns: list[ColumnMeta] = []
            if self.config.dialect == "sqlite":
                cur.execute(f"PRAGMA table_info({table_name})")
                for row in cur.fetchall():
                    columns.append(
                        ColumnMeta(
                            name=row[1],
                            data_type=row[2] or "TEXT",
                            is_nullable=row[3] == 0,
                            is_primary_key=bool(row[5]),
                        )
                    )
            else:
                cur.execute(
                    """
                    SELECT column_name, data_type, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = %s
                    ORDER BY ordinal_position
                    """,
                    (table_name,),
                )
                for row in cur.fetchall():
                    columns.append(
                        ColumnMeta(
                            name=row["column_name"],
                            data_type=row["data_type"],
                            is_nullable=row["is_nullable"] == "YES",
                        )
                    )
            return TableMeta(name=table_name, columns=columns)
        finally:
            conn.close()

    def get_schema_snapshot(self) -> SchemaSnapshot:
        tables = []
        for table_name in self.list_tables():
            tables.append(self.describe_table(table_name))
        payload = json.dumps(
            [{"name": t.name, "columns": [c.name for c in t.columns]} for t in tables],
            sort_keys=True,
        )
        schema_hash = hashlib.sha256(payload.encode()).hexdigest()[:16]
        return SchemaSnapshot(
            tenant_id=self.config.tenant_id,
            dialect=self.config.dialect,
            schema_hash=schema_hash,
            fetched_at=datetime.now(timezone.utc).isoformat(),
            tables=tables,
        )

    def _validate_read_sql(self, sql: str) -> str:
        cleaned = sql.strip().rstrip(";")
        if FORBIDDEN_SQL.search(cleaned):
            raise ValueError("Forbidden SQL keyword detected.")
        if not re.match(r"^\s*select\b", cleaned, re.IGNORECASE):
            raise ValueError("Only SELECT queries are allowed for read operations.")
        if ";" in cleaned:
            raise ValueError("Multiple statements are not allowed.")
        if not re.search(r"\blimit\b", cleaned, re.IGNORECASE):
            cleaned = f"{cleaned} LIMIT {READ_ROW_LIMIT}"
        return cleaned

    def _validate_write_sql(self, sql: str) -> str:
        cleaned = sql.strip().rstrip(";")
        if FORBIDDEN_SQL.search(cleaned):
            raise ValueError("Forbidden SQL keyword detected.")
        if not re.match(r"^\s*(insert|update|delete)\b", cleaned, re.IGNORECASE):
            raise ValueError("Only INSERT, UPDATE, or DELETE are allowed for write operations.")
        if ";" in cleaned:
            raise ValueError("Multiple statements are not allowed.")
        return cleaned

    def execute_read(self, sql: str, params: list[Any] | None = None) -> dict[str, Any]:
        query = self._validate_read_sql(sql)
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(query, params or [])
            rows = self._rows_to_dicts(cur.fetchall())
            return {"status": "ok", "row_count": len(rows), "rows": rows}
        except Exception as exc:
            return {"status": "error", "error": str(exc)}
        finally:
            conn.close()

    def execute_write(
        self, sql: str, params: list[Any] | None = None, confirmed: bool = False
    ) -> dict[str, Any]:
        if not confirmed:
            return {
                "status": "confirmation_required",
                "message": "Write operation requires explicit confirmation.",
                "pending_sql": sql,
            }
        query = self._validate_write_sql(sql)
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(query, params or [])
            conn.commit()
            rowcount = cur.rowcount if cur.rowcount is not None else 0
            return {"status": "ok", "rows_affected": rowcount}
        except Exception as exc:
            conn.rollback()
            return {"status": "error", "error": str(exc)}
        finally:
            conn.close()

    def get_tool_definitions(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "list_tables",
                "description": "List all user tables in the connected database.",
                "input_schema": {"type": "object", "properties": {}, "required": []},
            },
            {
                "name": "describe_table",
                "description": "Describe columns and types for a database table.",
                "input_schema": {
                    "type": "object",
                    "properties": {"table_name": {"type": "string"}},
                    "required": ["table_name"],
                },
            },
            {
                "name": "execute_read",
                "description": "Run a parameterized SELECT query. Only SELECT is allowed.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "sql": {"type": "string"},
                        "params": {"type": "array", "items": {}},
                    },
                    "required": ["sql"],
                },
            },
            {
                "name": "execute_write",
                "description": "Run INSERT, UPDATE, or DELETE. Requires confirmed=true.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "sql": {"type": "string"},
                        "params": {"type": "array", "items": {}},
                        "confirmed": {"type": "boolean"},
                    },
                    "required": ["sql"],
                },
            },
        ]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name == "list_tables":
            return {"status": "ok", "tables": self.list_tables()}
        if name == "describe_table":
            table = self.describe_table(arguments["table_name"])
            return {
                "status": "ok",
                "table": {
                    "name": table.name,
                    "columns": [c.__dict__ for c in table.columns],
                },
            }
        if name == "execute_read":
            return self.execute_read(arguments.get("sql", ""), arguments.get("params"))
        if name == "execute_write":
            return self.execute_write(
                arguments.get("sql", ""),
                arguments.get("params"),
                bool(arguments.get("confirmed", False)),
            )
        return {"status": "error", "error": f"Unknown tool: {name}"}
