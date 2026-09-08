from __future__ import annotations

import json
import math
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
        if self.use_sqlite:
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
                  section_path TEXT[] DEFAULT '{}',
                  chunk_index INT NOT NULL,
                  content TEXT NOT NULL,
                  metadata JSONB DEFAULT '{}',
                  embedding real[]
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
              section_path TEXT,
              chunk_index INTEGER NOT NULL,
              content TEXT NOT NULL,
              metadata TEXT,
              embedding TEXT
            )
            """
        )
        self._migrate_sqlite_schema(conn)
        conn.commit()
        conn.close()

    def _migrate_sqlite_schema(self, conn: sqlite3.Connection) -> None:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(document_chunks)").fetchall()}
        if "section_path" not in columns:
            conn.execute("ALTER TABLE document_chunks ADD COLUMN section_path TEXT")
        if "metadata" not in columns:
            conn.execute("ALTER TABLE document_chunks ADD COLUMN metadata TEXT")
        if "embedding" not in columns:
            conn.execute("ALTER TABLE document_chunks ADD COLUMN embedding TEXT")

    def _sqlite_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.sqlite_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        return conn

    def _serialize_document(self, row: Any) -> dict[str, Any]:
        data = dict(row)
        storage_path = data.get("storage_path") or data.get("storagePath")
        file_type = data.get("file_type") or data.get("fileType") or data.get("type") or "txt"
        return {
            "id": data.get("id"),
            "workspaceId": data.get("workspace_id") or data.get("workspaceId"),
            "workspace_id": data.get("workspace_id") or data.get("workspaceId"),
            "name": data.get("name"),
            "fileType": file_type,
            "file_type": file_type,
            "type": file_type,
            "storagePath": storage_path,
            "storage_path": storage_path,
            "status": data.get("status"),
            "error": data.get("error"),
            "size": data.get("size") or 0,
            "uploadedAt": data.get("uploaded_at") or data.get("uploadedAt") or 0,
            "uploaded_at": data.get("uploaded_at") or data.get("uploadedAt") or 0,
        }

    async def list_documents(self, workspace_id: str) -> list[dict[str, Any]]:
        if self.use_sqlite:
            conn = self._sqlite_conn()
            rows = conn.execute(
                "SELECT * FROM documents WHERE workspace_id = ? ORDER BY uploaded_at DESC",
                (workspace_id,),
            ).fetchall()
            conn.close()
            return [self._serialize_document(row) for row in rows]
        assert self.pool is not None
        rows = await self.pool.fetch(
            "SELECT * FROM documents WHERE workspace_id = $1 ORDER BY uploaded_at DESC",
            workspace_id,
        )
        return [self._serialize_document(row) for row in rows]

    async def get_document(self, doc_id: str) -> dict[str, Any] | None:
        if self.use_sqlite:
            conn = self._sqlite_conn()
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            conn.close()
            return self._serialize_document(row) if row else None
        assert self.pool is not None
        row = await self.pool.fetchrow("SELECT * FROM documents WHERE id = $1", doc_id)
        return self._serialize_document(row) if row else None

    async def get_unprocessed_documents(self) -> list[dict[str, Any]]:
        pending = ("uploaded", "processing", "embedding")
        if self.use_sqlite:
            conn = self._sqlite_conn()
            rows = conn.execute(
                "SELECT * FROM documents WHERE status IN (?, ?, ?) ORDER BY uploaded_at ASC",
                pending,
            ).fetchall()
            conn.close()
            return [dict(row) for row in rows]
        assert self.pool is not None
        rows = await self.pool.fetch(
            "SELECT * FROM documents WHERE status = ANY($1::varchar[]) ORDER BY uploaded_at ASC",
            list(pending),
        )
        return [dict(row) for row in rows]

    async def update_status(self, doc_id: str, status: str, error: str | None = None) -> None:
        if self.use_sqlite:
            conn = self._sqlite_conn()
            conn.execute(
                "UPDATE documents SET status = ?, error = ? WHERE id = ?",
                (status, error, doc_id),
            )
            conn.commit()
            conn.close()
            return
        assert self.pool is not None
        await self.pool.execute(
            "UPDATE documents SET status = $1, error = $2 WHERE id = $3",
            status,
            error,
            doc_id,
        )

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

    async def replace_chunks(self, doc_id: str, chunks: list[Any], embeddings: list[list[float]]) -> None:
        if self.use_sqlite:
            conn = self._sqlite_conn()
            conn.execute("DELETE FROM document_chunks WHERE document_id = ?", (doc_id,))
            for idx, chunk in enumerate(chunks):
                chunk_id = f"chunk_{doc_id}_{idx}"
                conn.execute(
                    """
                    INSERT INTO document_chunks
                    (id, workspace_id, document_id, document_name, section_path, chunk_index, content, metadata, embedding)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chunk_id,
                        chunk.workspace_id,
                        chunk.document_id,
                        chunk.document_name,
                        json.dumps(chunk.section_path),
                        chunk.chunk_index,
                        chunk.content,
                        json.dumps(chunk.metadata),
                        json.dumps(embeddings[idx]),
                    ),
                )
            conn.commit()
            conn.close()
            return

        assert self.pool is not None
        async with self.pool.acquire() as conn:
            await conn.execute("DELETE FROM document_chunks WHERE document_id = $1", doc_id)
            for idx, chunk in enumerate(chunks):
                chunk_id = f"chunk_{doc_id}_{idx}"
                await conn.execute(
                    """
                    INSERT INTO document_chunks
                    (id, workspace_id, document_id, document_name, section_path, chunk_index, content, metadata, embedding)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
                    """,
                    chunk_id,
                    chunk.workspace_id,
                    chunk.document_id,
                    chunk.document_name,
                    chunk.section_path,
                    chunk.chunk_index,
                    chunk.content,
                    json.dumps(chunk.metadata),
                    embeddings[idx],
                )

    async def delete_document(self, doc_id: str) -> bool:
        if self.use_sqlite:
            conn = self._sqlite_conn()
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not row:
                conn.close()
                return False
            if os.path.exists(row["storage_path"]):
                os.unlink(row["storage_path"])
            conn.execute("DELETE FROM document_chunks WHERE document_id = ?", (doc_id,))
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

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(y * y for y in b))
        if not norm_a or not norm_b:
            return 0.0
        return dot / (norm_a * norm_b)

    def _parse_embedding(self, embedding_raw: Any) -> list[float]:
        if embedding_raw is None:
            return []
        if isinstance(embedding_raw, str):
            parsed = json.loads(embedding_raw)
            return list(parsed) if parsed else []
        return list(embedding_raw)

    def _parse_metadata(self, metadata_raw: Any) -> dict[str, Any]:
        if metadata_raw is None:
            return {}
        if isinstance(metadata_raw, str):
            try:
                return json.loads(metadata_raw) if metadata_raw else {}
            except json.JSONDecodeError:
                return {}
        if isinstance(metadata_raw, dict):
            return metadata_raw
        return {}

    async def search_documents(
        self,
        workspace_id: str,
        query: str,
        document_ids: list[str] | None = None,
        top_k: int = 5,
    ) -> list[dict[str, Any]]:
        """Return ranked document chunks for RAG tool calling."""
        from .ingestion.embeddings import EmbeddingProvider

        rows = await self._fetch_chunks(workspace_id, document_ids)
        if not rows:
            return []

        embedder = EmbeddingProvider()
        query_embedding = (await embedder.embed_batch_async([query]))[0]
        if not query_embedding:
            raise RuntimeError("Failed to embed search query.")

        scored: list[tuple[float, dict[str, Any]]] = []
        for row in rows:
            embedding = self._parse_embedding(row.get("embedding"))
            if not embedding:
                continue
            score = self._cosine_similarity(query_embedding, embedding)
            scored.append((score, row))

        scored.sort(key=lambda item: item[0], reverse=True)
        results: list[dict[str, Any]] = []
        for score, row in scored[: max(1, top_k)]:
            metadata = self._parse_metadata(row.get("metadata"))
            results.append(
                {
                    "document_id": row.get("document_id"),
                    "document_name": row.get("document_name"),
                    "page": metadata.get("page"),
                    "chunk_id": row.get("id"),
                    "chunk_index": row.get("chunk_index"),
                    "content": row.get("content"),
                    "score": round(float(score), 4),
                    "metadata": metadata,
                }
            )
        return results

    async def retrieve_context(
        self, workspace_id: str, query: str, document_ids: list[str] | None = None, limit: int = 5
    ) -> str:
        results = await self.search_documents(workspace_id, query, document_ids, limit)
        if not results:
            return ""
        parts = []
        for item in results:
            page = item.get("page")
            page_label = f" page {page}" if page is not None else ""
            parts.append(f"[{item['document_name']}{page_label}]\n{item['content']}")
        return "\n\n".join(parts)

    async def _fetch_chunks(
        self, workspace_id: str, document_ids: list[str] | None = None
    ) -> list[dict[str, Any]]:
        columns = (
            "id, workspace_id, document_id, document_name, section_path, "
            "chunk_index, content, metadata, embedding"
        )
        # None => whole workspace; [] => no documents selected (return nothing).
        if document_ids is not None and len(document_ids) == 0:
            return []

        if self.use_sqlite:
            conn = self._sqlite_conn()
            if document_ids is not None:
                placeholders = ",".join("?" for _ in document_ids)
                rows = conn.execute(
                    f"""
                    SELECT {columns}
                    FROM document_chunks
                    WHERE workspace_id = ? AND document_id IN ({placeholders})
                    ORDER BY chunk_index ASC
                    """,
                    (workspace_id, *document_ids),
                ).fetchall()
            else:
                rows = conn.execute(
                    f"""
                    SELECT {columns}
                    FROM document_chunks
                    WHERE workspace_id = ?
                    ORDER BY chunk_index ASC
                    """,
                    (workspace_id,),
                ).fetchall()
            conn.close()
            return [dict(row) for row in rows]

        assert self.pool is not None
        if document_ids is not None:
            rows = await self.pool.fetch(
                f"""
                SELECT {columns}
                FROM document_chunks
                WHERE workspace_id = $1 AND document_id = ANY($2::varchar[])
                ORDER BY chunk_index ASC
                """,
                workspace_id,
                document_ids,
            )
        else:
            rows = await self.pool.fetch(
                f"""
                SELECT {columns}
                FROM document_chunks
                WHERE workspace_id = $1
                ORDER BY chunk_index ASC
                """,
                workspace_id,
            )
        return [dict(row) for row in rows]


document_service = DocumentService()
