"""Standalone document-retrieval engine.

This is the dedicated "document tool" the voice agent (and any other
caller) uses for RAG over uploaded files. It is intentionally its own
package with no dependency on sql-mcp/db-agent: database questions and
document questions are two independent capabilities, so the agent can
pick between them with a single, unambiguous tool call instead of
routing everything through one shared "database" MCP.

It reads the same chunk store the FastAPI ingestion worker
(backend/app/services/ingestion/worker.py) writes to — sqlite fallback
file or Postgres, same env vars — but never writes to it and never
imports backend/ code, so it can be embedded directly in the voice
agent process with no network hop to the FastAPI server.

Latency-relevant design choices:
  * Chunks (with their stored embeddings) are cached in memory per
    workspace with a short TTL, so a run of document questions in one
    conversation does not re-hit the DB and re-deserialize every chunk
    on every single turn — only the query embedding call is unavoidable.
  * If no Gemini API key is configured, or nothing has embeddings yet
    (e.g. still being ingested), search degrades to a fast local
    keyword-overlap ranking instead of failing or returning irrelevant
    chunks — the caller still gets a decisive, usable answer.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import RetrievalConfig, RetrievedChunk

_WORD_RE = re.compile(r"[a-z0-9]+")


@dataclass
class _CacheEntry:
    fetched_at: float
    rows: list[dict[str, Any]]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if not norm_a or not norm_b:
        return 0.0
    return dot / (norm_a * norm_b)


def _tokenize(text: str) -> set[str]:
    return set(_WORD_RE.findall(text.lower()))


class DocRetrievalEngine:
    """Fast, dedicated retrieval tool for ingested documents."""

    def __init__(self, config: RetrievalConfig | None = None):
        self.config = config or RetrievalConfig()
        self._cache: dict[str, _CacheEntry] = {}
        self._genai_client = None

    # -- embeddings ----------------------------------------------------

    def _get_client(self):
        if self._genai_client is None:
            if not self.config.gemini_api_key:
                raise RuntimeError("GEMINI_API_KEY is not configured.")
            from google import genai

            self._genai_client = genai.Client(api_key=self.config.gemini_api_key)
        return self._genai_client

    def _normalize(self, values: list[float]) -> list[float]:
        vector = values[: self.config.embedding_dimension]
        norm = math.sqrt(sum(v * v for v in vector))
        if not norm:
            return vector
        return [v / norm for v in vector]

    def _embed_query(self, text: str) -> list[float]:
        from google.genai import types

        client = self._get_client()
        response = client.models.embed_content(
            model=self.config.embedding_model,
            contents=[text],
            config=types.EmbedContentConfig(output_dimensionality=self.config.embedding_dimension),
        )
        if not response.embeddings:
            raise RuntimeError("Embedding API returned no vectors.")
        return self._normalize(list(response.embeddings[0].values))

    # -- storage ---------------------------------------------------------

    def _sqlite_path(self) -> Path:
        return Path(self.config.upload_dir) / "platform.db"

    def _fetch_chunks_sqlite(
        self, path: Path, workspace_id: str, document_ids: list[str] | None
    ) -> list[dict[str, Any]]:
        conn = sqlite3.connect(str(path), timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            if document_ids:
                placeholders = ",".join("?" for _ in document_ids)
                rows = conn.execute(
                    f"""
                    SELECT content, document_name, embedding
                    FROM document_chunks
                    WHERE workspace_id = ? AND document_id IN ({placeholders})
                    ORDER BY chunk_index ASC
                    """,
                    (workspace_id, *document_ids),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT content, document_name, embedding
                    FROM document_chunks
                    WHERE workspace_id = ?
                    ORDER BY chunk_index ASC
                    """,
                    (workspace_id,),
                ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def _fetch_chunks_postgres(
        self, workspace_id: str, document_ids: list[str] | None
    ) -> list[dict[str, Any]]:
        import psycopg2
        from psycopg2.extras import RealDictCursor

        conn = psycopg2.connect(
            host=self.config.pg_host,
            port=self.config.pg_port,
            user=self.config.pg_user,
            password=self.config.pg_password,
            dbname=self.config.pg_database,
            cursor_factory=RealDictCursor,
            connect_timeout=3,
        )
        try:
            cur = conn.cursor()
            if document_ids:
                cur.execute(
                    """
                    SELECT content, document_name, embedding
                    FROM document_chunks
                    WHERE workspace_id = %s AND document_id = ANY(%s::varchar[])
                    ORDER BY chunk_index ASC
                    """,
                    (workspace_id, document_ids),
                )
            else:
                cur.execute(
                    """
                    SELECT content, document_name, embedding
                    FROM document_chunks
                    WHERE workspace_id = %s
                    ORDER BY chunk_index ASC
                    """,
                    (workspace_id,),
                )
            return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()

    def _fetch_chunks(self, workspace_id: str, document_ids: list[str] | None) -> list[dict[str, Any]]:
        sqlite_path = self._sqlite_path()
        if sqlite_path.exists():
            try:
                return self._fetch_chunks_sqlite(sqlite_path, workspace_id, document_ids)
            except Exception:
                return []
        try:
            return self._fetch_chunks_postgres(workspace_id, document_ids)
        except Exception:
            return []

    def _get_chunks(self, workspace_id: str, document_ids: list[str] | None) -> list[dict[str, Any]]:
        if document_ids:
            # Scoped requests are uncommon in voice and cheap (indexed lookup) —
            # always fetch fresh rather than caching every id-subset combination.
            return self._fetch_chunks(workspace_id, document_ids)

        entry = self._cache.get(workspace_id)
        now = time.monotonic()
        if entry is not None and (now - entry.fetched_at) < self.config.cache_ttl_seconds:
            return entry.rows

        rows = self._fetch_chunks(workspace_id, None)
        self._cache[workspace_id] = _CacheEntry(fetched_at=now, rows=rows)
        return rows

    def invalidate(self, workspace_id: str | None = None) -> None:
        """Drop the cache — call after an upload finishes ingesting, if you
        want the very next turn to see it instead of waiting out the TTL."""
        if workspace_id is None:
            self._cache.clear()
        else:
            self._cache.pop(workspace_id, None)

    # -- ranking -----------------------------------------------------

    def _parse_embedding(self, raw: Any) -> list[float] | None:
        if not raw:
            return None
        if isinstance(raw, str):
            try:
                return json.loads(raw)
            except (TypeError, ValueError):
                return None
        return list(raw)

    def _keyword_rank(self, query: str, rows: list[dict[str, Any]], top_k: int) -> list[RetrievedChunk]:
        query_terms = _tokenize(query)
        if not query_terms:
            return [
                RetrievedChunk(document_name=r["document_name"], content=r["content"], score=0.0)
                for r in rows[:top_k]
            ]
        scored = []
        for row in rows:
            content_terms = _tokenize(row["content"])
            overlap = len(query_terms & content_terms)
            if overlap:
                scored.append((overlap / len(query_terms), row))
        if not scored:
            return [
                RetrievedChunk(document_name=r["document_name"], content=r["content"], score=0.0)
                for r in rows[:top_k]
            ]
        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            RetrievedChunk(document_name=r["document_name"], content=r["content"], score=s)
            for s, r in scored[:top_k]
        ]

    # -- public API -----------------------------------------------------

    def has_any_documents(self, workspace_id: str = "default_workspace") -> bool:
        return len(self._get_chunks(workspace_id, None)) > 0

    def search(
        self,
        query: str,
        workspace_id: str = "default_workspace",
        document_ids: list[str] | None = None,
        top_k: int = 5,
    ) -> list[RetrievedChunk]:
        rows = self._get_chunks(workspace_id, document_ids)
        if not rows:
            return []

        try:
            query_embedding = self._embed_query(query)
        except Exception:
            return self._keyword_rank(query, rows, top_k)

        scored = []
        for row in rows:
            vec = self._parse_embedding(row.get("embedding"))
            if not vec:
                continue
            score = _cosine_similarity(query_embedding, vec)
            scored.append((score, row))

        if not scored:
            return self._keyword_rank(query, rows, top_k)

        scored.sort(key=lambda item: item[0], reverse=True)
        return [
            RetrievedChunk(document_name=r["document_name"], content=r["content"], score=s)
            for s, r in scored[:top_k]
        ]

    def format_context(self, chunks: list[RetrievedChunk]) -> str:
        if not chunks:
            return ""
        return "\n\n".join(f"[{c.document_name}]\n{c.content}" for c in chunks)
