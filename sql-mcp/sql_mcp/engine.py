from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .demo_billing import ensure_demo_database
from .manifest import ToolDefinition, ToolManifest
from .manifest import compile_manifest as _compile_manifest
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
        self._manifest: ToolManifest | None = None
        self._conn: Any | None = None
        self._ensure_demo_sqlite()

    def update_connection(self, config: ConnectionConfig) -> None:
        self.close()
        self.config = config
        self._manifest = None
        self._ensure_demo_sqlite()

    def close(self) -> None:
        """Close the pooled connection if open."""
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    def disconnect(self) -> None:
        """Alias for close() — release the persistent DB connection."""
        self.close()

    def _ensure_demo_sqlite(self) -> None:
        # Only auto-seed the known medical-billing demo DB — never clobber
        # arbitrary user sqlite files.
        if not self.config.is_demo_sqlite():
            return
        resolved = self._resolve_sqlite_path()
        self.config.database = str(resolved)
        ensure_demo_database(resolved)

    def _resolve_sqlite_path(self) -> Path:
        """Resolve sqlite paths relative to cwd or the monorepo root.

        Uvicorn runs with cwd=backend/, so bare filenames like
        ``test_connector_database.db`` must also be looked up in the repo root.
        """
        raw = Path(self.config.database)
        if raw.is_absolute():
            return raw

        cwd_candidate = (Path.cwd() / raw).resolve()
        if cwd_candidate.exists():
            return cwd_candidate

        # sql_mcp/engine.py -> sql_mcp -> sql-mcp -> repo root
        repo_root = Path(__file__).resolve().parents[2]
        root_candidate = (repo_root / raw).resolve()
        if root_candidate.exists():
            return root_candidate

        # Prefer repo-root target for newly created files when cwd is backend/
        if Path.cwd().name.lower() == "backend" and (Path.cwd().parent / raw).parent.exists():
            return (Path.cwd().parent / raw).resolve()
        return cwd_candidate

    def _connect_sqlite(self) -> sqlite3.Connection:
        db_path = self._resolve_sqlite_path()
        # Persist the resolved path so logs / status show a usable file location.
        self.config.database = str(db_path)
        if not db_path.exists():
            raise FileNotFoundError(f"SQLite database file not found: {db_path}")
        conn = sqlite3.connect(str(db_path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
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

    def _connect_mysql(self):
        import pymysql
        from pymysql.cursors import DictCursor

        return pymysql.connect(
            host=self.config.host,
            port=int(self.config.port or 3306),
            user=self.config.user,
            password=self.config.password,
            database=self.config.database,
            cursorclass=DictCursor,
            autocommit=False,
        )

    def _open_connection(self):
        if self.config.dialect == "sqlite":
            return self._connect_sqlite()
        if self.config.dialect == "postgres":
            return self._connect_postgres()
        if self.config.dialect == "mysql":
            return self._connect_mysql()
        raise ValueError(f"Unsupported dialect: {self.config.dialect}")

    def _get_connection(self):
        """Return the persistent connection, opening one if needed."""
        if self._conn is None:
            self._conn = self._open_connection()
        return self._conn

    def _reset_connection(self) -> None:
        """Drop a broken pooled connection so the next call reopens."""
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    def _is_fatal_connection_error(self, exc: BaseException) -> bool:
        name = type(exc).__name__.lower()
        msg = str(exc).lower()
        fatal_markers = (
            "connection",
            "closed",
            "gone away",
            "broken pipe",
            "server has gone",
            "interfaceerror",
            "operationalerror",
            "not connected",
            "lost connection",
        )
        if any(m in name for m in ("interface", "operational", "connection")):
            # Narrow: only treat as fatal when the message looks connection-related,
            # so constraint/integrity OperationalErrors keep the pool alive.
            if any(m in msg for m in fatal_markers):
                return True
            if "no such" in msg or "syntax" in msg or "constraint" in msg or "unique" in msg:
                return False
            # sqlite OperationalError for "unable to open" etc.
            if "unable to open" in msg or "disk i/o" in msg:
                return True
        return any(
            m in msg
            for m in (
                "connection already closed",
                "server closed the connection",
                "mysql server has gone away",
                "broken pipe",
                "not connected",
                "lost connection",
            )
        )

    def _rows_to_dicts(self, rows: list[Any]) -> list[dict[str, Any]]:
        if not rows:
            return []
        first = rows[0]
        if isinstance(first, sqlite3.Row):
            return [dict(row) for row in rows]
        if isinstance(first, dict):
            return list(rows)
        return [dict(row) for row in rows]

    def _placeholder(self) -> str:
        # postgres and mysql use pyformat %s; sqlite uses ?
        if self.config.dialect in ("postgres", "mysql"):
            return "%s"
        return "?"

    def list_tables(self) -> list[str]:
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            if self.config.dialect == "sqlite":
                cur.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )
                return [row[0] for row in cur.fetchall()]
            if self.config.dialect == "mysql":
                cur.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                    """
                )
                rows = cur.fetchall()
                return [row["table_name"] if isinstance(row, dict) else row[0] for row in rows]
            # postgres
            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            )
            return [row["table_name"] for row in cur.fetchall()]
        except Exception as exc:
            if self._is_fatal_connection_error(exc):
                self._reset_connection()
            raise

    def describe_table(self, table_name: str) -> TableMeta:
        conn = self._get_connection()
        try:
            if self.config.dialect == "sqlite":
                return self._describe_sqlite(conn, table_name)
            if self.config.dialect == "mysql":
                return self._describe_mysql(conn, table_name)
            return self._describe_postgres(conn, table_name)
        except Exception as exc:
            if self._is_fatal_connection_error(exc):
                self._reset_connection()
            raise

    def _describe_sqlite(self, conn: Any, table_name: str) -> TableMeta:
        cur = conn.cursor()
        cur.execute(f"PRAGMA table_info({table_name})")
        info_rows = cur.fetchall()
        fk_map: dict[str, tuple[str, str]] = {}
        try:
            cur.execute(f"PRAGMA foreign_key_list({table_name})")
            for row in cur.fetchall():
                # id, seq, table, from, to, on_update, on_delete, match
                from_col = row[3]
                ref_table = row[2]
                ref_col = row[4]
                fk_map[from_col] = (ref_table, ref_col)
        except Exception:
            pass

        columns: list[ColumnMeta] = []
        for row in info_rows:
            name = row[1]
            ref = fk_map.get(name)
            columns.append(
                ColumnMeta(
                    name=name,
                    data_type=row[2] or "TEXT",
                    is_nullable=row[3] == 0,
                    is_primary_key=bool(row[5]),
                    is_foreign_key=ref is not None,
                    references_table=ref[0] if ref else None,
                    references_column=ref[1] if ref else None,
                )
            )
        return TableMeta(name=table_name, columns=columns)

    def _describe_postgres(self, conn: Any, table_name: str) -> TableMeta:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table_name,),
        )
        col_rows = cur.fetchall()

        pk_cols: set[str] = set()
        try:
            cur.execute(
                """
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema = 'public'
                  AND tc.table_name = %s
                """,
                (table_name,),
            )
            for row in cur.fetchall():
                pk_cols.add(row["column_name"])
        except Exception:
            pass

        fk_map: dict[str, tuple[str, str]] = {}
        try:
            cur.execute(
                """
                SELECT
                    kcu.column_name AS column_name,
                    ccu.table_name AS references_table,
                    ccu.column_name AS references_column
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON ccu.constraint_name = tc.constraint_name
                 AND ccu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND tc.table_schema = 'public'
                  AND tc.table_name = %s
                """,
                (table_name,),
            )
            for row in cur.fetchall():
                fk_map[row["column_name"]] = (row["references_table"], row["references_column"])
        except Exception:
            pass

        columns: list[ColumnMeta] = []
        for row in col_rows:
            name = row["column_name"]
            ref = fk_map.get(name)
            columns.append(
                ColumnMeta(
                    name=name,
                    data_type=row["data_type"],
                    is_nullable=row["is_nullable"] == "YES",
                    is_primary_key=name in pk_cols,
                    is_foreign_key=ref is not None,
                    references_table=ref[0] if ref else None,
                    references_column=ref[1] if ref else None,
                )
            )
        return TableMeta(name=table_name, columns=columns)

    def _describe_mysql(self, conn: Any, table_name: str) -> TableMeta:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT column_name, data_type, is_nullable, column_key
            FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table_name,),
        )
        col_rows = cur.fetchall()

        fk_map: dict[str, tuple[str, str]] = {}
        try:
            cur.execute(
                """
                SELECT
                    column_name,
                    referenced_table_name,
                    referenced_column_name
                FROM information_schema.key_column_usage
                WHERE table_schema = DATABASE()
                  AND table_name = %s
                  AND referenced_table_name IS NOT NULL
                """,
                (table_name,),
            )
            for row in cur.fetchall():
                col = row["column_name"] if isinstance(row, dict) else row[0]
                ref_table = row["referenced_table_name"] if isinstance(row, dict) else row[1]
                ref_col = row["referenced_column_name"] if isinstance(row, dict) else row[2]
                fk_map[col] = (ref_table, ref_col)
        except Exception:
            pass

        columns: list[ColumnMeta] = []
        for row in col_rows:
            if isinstance(row, dict):
                name = row["column_name"]
                data_type = row["data_type"]
                is_nullable = row["is_nullable"] == "YES"
                column_key = (row.get("column_key") or "").upper()
            else:
                name = row[0]
                data_type = row[1]
                is_nullable = row[2] == "YES"
                column_key = (row[3] or "").upper()
            ref = fk_map.get(name)
            columns.append(
                ColumnMeta(
                    name=name,
                    data_type=data_type,
                    is_nullable=is_nullable,
                    is_primary_key=column_key == "PRI",
                    is_foreign_key=ref is not None,
                    references_table=ref[0] if ref else None,
                    references_column=ref[1] if ref else None,
                )
            )
        return TableMeta(name=table_name, columns=columns)

    def get_schema_snapshot(self) -> SchemaSnapshot:
        tables = []
        for table_name in self.list_tables():
            tables.append(self.describe_table(table_name))
        # Include types + PK/FK so type/key changes invalidate the cache.
        payload = json.dumps(
            [
                {
                    "name": t.name,
                    "columns": [
                        {
                            "name": c.name,
                            "data_type": c.data_type,
                            "is_primary_key": c.is_primary_key,
                            "is_foreign_key": c.is_foreign_key,
                        }
                        for c in t.columns
                    ],
                }
                for t in tables
            ],
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

    def test_connection(self) -> dict[str, Any]:
        """Open/use the connection and list tables without compiling a manifest.

        Safe to call before committing a connection into a registry — does not
        produce voice-path side effects beyond the connection check itself.
        """
        try:
            tables = self.list_tables()
            return {
                "status": "ok",
                "dialect": self.config.dialect,
                "tableCount": len(tables),
                "tables": tables,
            }
        except Exception as exc:
            if self._is_fatal_connection_error(exc):
                self._reset_connection()
            return {
                "status": "error",
                "error": str(exc),
                "dialect": self.config.dialect,
                "tableCount": 0,
                "tables": [],
            }

    # ------------------------------------------------------------------
    # Compiled fast-path (see sql_mcp/manifest.py). Schema is introspected
    # once and compiled into a small set of deterministic, per-table tools
    # so the calling LLM never has to spend a turn discovering the schema
    # or hand-writing SQL for common lookups. This mirrors db-agent's
    # DatabaseAgent.syncManifest()/callTool() from commit 55632b8.
    # ------------------------------------------------------------------

    def compile_manifest(self, force: bool = False) -> ToolManifest:
        """Introspect the schema and (re)compile the tool manifest.

        Cheap to call repeatedly — it's a no-op recompile if the schema
        hash hasn't changed since the last call.
        """
        snapshot = self.get_schema_snapshot()
        if not force and self._manifest is not None and self._manifest.schema_hash == snapshot.schema_hash:
            return self._manifest
        previous_version = self._manifest.version if self._manifest else 0
        self._manifest = _compile_manifest(snapshot, previous_version)
        return self._manifest

    def get_manifest(self) -> ToolManifest | None:
        return self._manifest

    def call_manifest_tool(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        arguments = dict(arguments or {})
        if self._manifest is None:
            self.compile_manifest()
        assert self._manifest is not None
        tool = self._manifest.find(name)
        if tool is None:
            return {
                "status": "not_found",
                "error": (
                    f'No tool named "{name}" in manifest v{self._manifest.version}. '
                    "Use run_custom_read_query for anything not covered by a compiled tool."
                ),
            }
        return self._execute_manifest_tool(tool, arguments)

    def _validate_manifest_params(self, tool: ToolDefinition, arguments: dict[str, Any]) -> None:
        allowed = {p.name for p in tool.params}
        allowed.add("confirmed")
        for p in tool.params:
            if p.required and p.name not in arguments:
                raise ValueError(f'Missing required param "{p.name}" for tool "{tool.name}"')
        for key in arguments:
            if key not in allowed:
                raise ValueError(
                    f'Unexpected param "{key}" for tool "{tool.name}" — not part of the compiled manifest'
                )

    def _build_filters(
        self, params: list[Any], arguments: dict[str, Any], ph: str
    ) -> tuple[str, list[Any]]:
        clauses = []
        values: list[Any] = []
        for p in params:
            if arguments.get(p.name) is not None:
                clauses.append(f"{p.name} = {ph}")
                values.append(arguments[p.name])
        where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        return where_sql, values

    def _describe_write(self, tool: ToolDefinition, arguments: dict[str, Any]) -> str:
        payload = {k: v for k, v in arguments.items() if k != "confirmed"}
        return f'{tool.operation} on "{tool.table}" with {json.dumps(payload, default=str)}'

    def _mysql_fetch_by_lastrowid(
        self, cur: Any, table: str, lastrowid: Any, ph: str
    ) -> dict[str, Any] | None:
        """Best-effort re-select after MySQL INSERT using AUTO_INCREMENT lastrowid."""
        try:
            cur.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = DATABASE()
                  AND table_name = %s
                  AND column_key = 'PRI'
                ORDER BY ordinal_position
                LIMIT 1
                """,
                (table,),
            )
            row = cur.fetchone()
            if not row:
                return None
            pk_name = row["column_name"] if isinstance(row, dict) else row[0]
            cur.execute(f"SELECT * FROM {table} WHERE {pk_name} = {ph}", [lastrowid])
            fetched = cur.fetchone()
            if fetched is None:
                return None
            return self._rows_to_dicts([fetched])[0]
        except Exception:
            return None

    def _execute_manifest_tool(self, tool: ToolDefinition, arguments: dict[str, Any]) -> dict[str, Any]:
        try:
            self._validate_manifest_params(tool, arguments)
        except ValueError as exc:
            return {"status": "error", "error": str(exc), "tool_used": tool.name}

        if tool.is_write and not bool(arguments.get("confirmed", False)):
            return {
                "status": "confirmation_required",
                "tool_used": tool.name,
                "message": "This change requires explicit user confirmation before it runs.",
                "pending_change": self._describe_write(tool, arguments),
            }

        ph = self._placeholder()
        conn = self._get_connection()
        try:
            cur = conn.cursor()

            if tool.operation == "get_by_id":
                pk = tool.params[0]
                cur.execute(f"SELECT * FROM {tool.table} WHERE {pk.name} = {ph} LIMIT 1", [arguments[pk.name]])
                row = cur.fetchone()
                rows = self._rows_to_dicts([row] if row is not None else [])
                data = rows[0] if rows else None
                return {"status": "ok", "data": data, "row_count": len(rows), "tool_used": tool.name}

            if tool.operation == "list":
                where_sql, values = self._build_filters(tool.params, arguments, ph)
                cur.execute(f"SELECT * FROM {tool.table}{where_sql} LIMIT {READ_ROW_LIMIT}", values)
                rows = self._rows_to_dicts(cur.fetchall())
                return {"status": "ok", "data": rows, "row_count": len(rows), "tool_used": tool.name}

            if tool.operation == "count":
                where_sql, values = self._build_filters(tool.params, arguments, ph)
                cur.execute(f"SELECT COUNT(*) as count FROM {tool.table}{where_sql}", values)
                row = cur.fetchone()
                count_val = self._rows_to_dicts([row])[0]["count"] if row is not None else 0
                return {"status": "ok", "data": {"count": count_val}, "tool_used": tool.name}

            if tool.operation == "create":
                columns = [p.name for p in tool.params if p.name in arguments]
                if not columns:
                    return {"status": "error", "error": "No fields provided to insert.", "tool_used": tool.name}
                values = [arguments[c] for c in columns]
                col_sql = ", ".join(columns)
                placeholders = ", ".join([ph] * len(columns))

                if self.config.dialect == "postgres":
                    cur.execute(
                        f"INSERT INTO {tool.table} ({col_sql}) VALUES ({placeholders}) RETURNING *",
                        values,
                    )
                    row = cur.fetchone()
                    conn.commit()
                    inserted = self._rows_to_dicts([row])[0] if row else dict(zip(columns, values))
                elif self.config.dialect == "sqlite":
                    cur.execute(f"INSERT INTO {tool.table} ({col_sql}) VALUES ({placeholders})", values)
                    conn.commit()
                    inserted = dict(zip(columns, values))
                    if cur.lastrowid is not None:
                        cur.execute(f"SELECT * FROM {tool.table} WHERE rowid = ?", [cur.lastrowid])
                        row = cur.fetchone()
                        if row is not None:
                            inserted = self._rows_to_dicts([row])[0]
                else:
                    # MySQL — no RETURNING; re-select via lastrowid when possible.
                    cur.execute(f"INSERT INTO {tool.table} ({col_sql}) VALUES ({placeholders})", values)
                    conn.commit()
                    inserted = dict(zip(columns, values))
                    lastrowid = getattr(cur, "lastrowid", None)
                    if lastrowid is not None:
                        reselected = self._mysql_fetch_by_lastrowid(cur, tool.table, lastrowid, ph)
                        if reselected is not None:
                            inserted = reselected
                return {"status": "ok", "data": inserted, "row_count": 1, "tool_used": tool.name}

            if tool.operation == "update_by_id":
                pk = tool.params[0]
                set_columns = [p.name for p in tool.params[1:] if p.name in arguments]
                if not set_columns:
                    return {"status": "error", "error": "No fields to update were provided", "tool_used": tool.name}
                set_sql = ", ".join(f"{c} = {ph}" for c in set_columns)
                values = [arguments[c] for c in set_columns] + [arguments[pk.name]]

                if self.config.dialect == "postgres":
                    cur.execute(
                        f"UPDATE {tool.table} SET {set_sql} WHERE {pk.name} = {ph} RETURNING *", values
                    )
                    row = cur.fetchone()
                    conn.commit()
                    data = self._rows_to_dicts([row])[0] if row else None
                    return {"status": "ok", "data": data, "row_count": cur.rowcount, "tool_used": tool.name}

                cur.execute(f"UPDATE {tool.table} SET {set_sql} WHERE {pk.name} = {ph}", values)
                updated_rows = cur.rowcount
                conn.commit()
                cur.execute(f"SELECT * FROM {tool.table} WHERE {pk.name} = {ph}", [arguments[pk.name]])
                row = cur.fetchone()
                data = self._rows_to_dicts([row])[0] if row else None
                return {"status": "ok", "data": data, "row_count": updated_rows, "tool_used": tool.name}

            if tool.operation == "delete_by_id":
                pk = tool.params[0]
                cur.execute(f"DELETE FROM {tool.table} WHERE {pk.name} = {ph}", [arguments[pk.name]])
                deleted_rows = cur.rowcount
                conn.commit()
                return {"status": "ok", "row_count": deleted_rows, "tool_used": tool.name}

            return {"status": "error", "error": f"Unhandled operation: {tool.operation}", "tool_used": tool.name}
        except Exception as exc:
            try:
                conn.rollback()
            except Exception:
                pass
            if self._is_fatal_connection_error(exc):
                self._reset_connection()
            return {"status": "error", "error": str(exc), "tool_used": tool.name}

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
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute(query, params or [])
            rows = self._rows_to_dicts(cur.fetchall())
            return {"status": "ok", "row_count": len(rows), "rows": rows}
        except Exception as exc:
            if self._is_fatal_connection_error(exc):
                self._reset_connection()
            return {"status": "error", "error": str(exc)}

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
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute(query, params or [])
            conn.commit()
            rowcount = cur.rowcount if cur.rowcount is not None else 0
            return {"status": "ok", "rows_affected": rowcount}
        except Exception as exc:
            try:
                conn.rollback()
            except Exception:
                pass
            if self._is_fatal_connection_error(exc):
                self._reset_connection()
            return {"status": "error", "error": str(exc)}

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
