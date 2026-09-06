from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

import asyncpg

from ..config import settings

SAMPLE_DOCUMENTS = [
    {
        "name": "PROJECT_AURORA_README.md",
        "type": "markdown",
        "content": """# Project Aurora: Next-Gen Event Processing Engine

Project Aurora is a distributed streaming pipeline for real-time telemetry.
It processes up to 250,000 events per second with sub-five-millisecond p99 latency.
""",
    },
    {
        "name": "Q3_PRODUCT_STRATEGY.txt",
        "type": "text",
        "content": """Q3 Product Strategy
- Expand mobile voice experiences
- Complete SOC2 Type II certification
- Launch European data residency in Frankfurt
""",
    },
]


class DocumentService:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None
        self.sqlite_path = Path(settings.upload_dir) / "platform.db"
        self.use_sqlite = False
        Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)

    async def connect(self) -> None:
        try:
            self.pool = await asyncpg.create_pool(
                host=settings.pg_host,
                port=settings.pg_port,
                user=settings.pg_user,
                password=settings.pg_password,
                database=settings.pg_database,
                timeout=3,
            )
            await self._setup_postgres_schema()
            self.use_sqlite = False
        except Exception as exc:
            print(f"[DocumentService] PostgreSQL unavailable ({exc}); using SQLite fallback.")
            self.use_sqlite = True
            self._setup_sqlite_schema()

    async def _setup_postgres_schema(self) -> None:
        assert self.pool is not None
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS documents (
                  id VARCHAR(100) PRIMARY KEY,
                  workspace_id VARCHAR(100) NOT NULL,
                  name VARCHAR(255) NOT NULL,
                  file_type VARCHAR(50) NOT NULL,
                  storage_path VARCHAR(512) NOT NULL,
                  status VARCHAR(50) NOT NULL,
                  error TEXT,
                  size INT NOT NULL,
                  uploaded_at BIGINT NOT NULL
                )
                """
            )
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS document_chunks (
                  id VARCHAR(100) PRIMARY KEY,
                  workspace_id VARCHAR(100) NOT NULL,
                  document_id VARCHAR(100) REFERENCES documents(id) ON DELETE CASCADE,
                  document_name VARCHAR(255) NOT NULL,
                  chunk_index INT NOT NULL,
                  content TEXT NOT NULL
                )
                """
            )

    def _setup_sqlite_schema(self) -> None:
        conn = sqlite3.connect(self.sqlite_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
              id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              name TEXT NOT NULL,
              file_type TEXT NOT NULL,
              storage_path TEXT NOT NULL,
              status TEXT NOT NULL,
              error TEXT,
              size INTEGER NOT NULL,
              uploaded_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS document_chunks (
              id TEXT PRIMARY KEY,
              workspace_id TEXT NOT NULL,
              document_id TEXT NOT NULL,
              document_name TEXT NOT NULL,
              chunk_index INTEGER NOT NULL,
              content TEXT NOT NULL
            )
            """
        )
        conn.commit()
        conn.close()

    def _sqlite_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.sqlite_path)
        conn.row_factory = sqlite3.Row
        return conn

    async def list_documents(self, workspace_id: str) -> list[dict[str, Any]]:
        if self.use_sqlite:
            conn = self._sqlite_conn()
            rows = conn.execute(
                "SELECT * FROM documents WHERE workspace_id = ? ORDER BY uploaded_at DESC",
                (workspace_id,),
            ).fetchall()
            conn.close()
            return [dict(row) for row in rows]
        assert self.pool is not None
        rows = await self.pool.fetch(
            "SELECT * FROM documents WHERE workspace_id = $1 ORDER BY uploaded_at DESC",
            workspace_id,
        )
        return [dict(row) for row in rows]

    async def create_document(self, workspace_id: str, name: str, file_type: str, storage_path: str, size: int) -> dict:
        doc_id = f"doc_{int(time.time() * 1000)}"
        uploaded_at = int(time.time() * 1000)
        if self.use_sqlite:
            conn = self._sqlite_conn()
            conn.execute(
                "INSERT INTO documents VALUES (?, ?, ?, ?, ?, 'uploaded', NULL, ?, ?)",
                (doc_id, workspace_id, name, file_type, storage_path, size, uploaded_at),
            )
            conn.commit()
            conn.close()
        else:
            assert self.pool is not None
            await self.pool.execute(
                """
                INSERT INTO documents (id, workspace_id, name, file_type, storage_path, status, size, uploaded_at)
                VALUES ($1, $2, $3, $4, $5, 'uploaded', $6, $7)
                """,
                doc_id,
                workspace_id,
                name,
                file_type,
                storage_path,
                size,
                uploaded_at,
            )
        return {
            "id": doc_id,
            "workspaceId": workspace_id,
            "name": name,
            "fileType": file_type,
            "storagePath": storage_path,
            "status": "uploaded",
            "size": size,
            "uploadedAt": uploaded_at,
        }

    async def delete_document(self, doc_id: str) -> bool:
        if self.use_sqlite:
            conn = self._sqlite_conn()
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not row:
                conn.close()
                return False
            if os.path.exists(row["storage_path"]):
                os.unlink(row["storage_path"])
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
            conn.commit()
            conn.close()
            return True
        assert self.pool is not None
        row = await self.pool.fetchrow("SELECT * FROM documents WHERE id = $1", doc_id)
        if not row:
            return False
        if os.path.exists(row["storage_path"]):
            os.unlink(row["storage_path"])
        await self.pool.execute("DELETE FROM documents WHERE id = $1", doc_id)
        return True

    async def reset_samples(self, workspace_id: str) -> list[dict[str, Any]]:
        existing = await self.list_documents(workspace_id)
        for doc in existing:
            await self.delete_document(doc["id"])
        created = []
        for sample in SAMPLE_DOCUMENTS:
            doc_id = f"doc_sample_{int(time.time() * 1000)}"
            storage_path = str(Path(settings.upload_dir) / f"{doc_id}.txt")
            Path(storage_path).write_text(sample["content"], encoding="utf-8")
            created.append(
                await self.create_document(
                    workspace_id,
                    sample["name"],
                    sample["type"],
                    storage_path,
                    len(sample["content"].encode("utf-8")),
                )
            )
        return created

    async def retrieve_context(
        self, workspace_id: str, query: str, document_ids: list[str] | None = None, limit: int = 5
    ) -> str:
        if self.use_sqlite:
            conn = self._sqlite_conn()
            if document_ids:
                placeholders = ",".join("?" for _ in document_ids)
                rows = conn.execute(
                    f"""
                    SELECT content, document_name FROM document_chunks
                    WHERE workspace_id = ? AND document_id IN ({placeholders})
                    ORDER BY chunk_index ASC LIMIT ?
                    """,
                    (workspace_id, *document_ids, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT content, document_name FROM document_chunks WHERE workspace_id = ? ORDER BY chunk_index ASC LIMIT ?",
                    (workspace_id, limit),
                ).fetchall()
            conn.close()
        else:
            assert self.pool is not None
            if document_ids:
                rows = await self.pool.fetch(
                    """
                    SELECT content, document_name
                    FROM document_chunks
                    WHERE workspace_id = $1 AND document_id = ANY($2::varchar[])
                    ORDER BY chunk_index ASC
                    LIMIT $3
                    """,
                    workspace_id,
                    document_ids,
                    limit,
                )
            else:
                rows = await self.pool.fetch(
                    """
                    SELECT content, document_name
                    FROM document_chunks
                    WHERE workspace_id = $1
                    ORDER BY chunk_index ASC
                    LIMIT $2
                    """,
                    workspace_id,
                    limit,
                )
        if not rows:
            return ""
        parts = [f"[{row['document_name']}]\n{row['content']}" for row in rows]
        return "\n\n".join(parts)


document_service = DocumentService()
