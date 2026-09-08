from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class RetrievalConfig:
    """Points at the same document store the ingestion worker writes to.

    Mirrors backend/app/config.py's env var names exactly so this package
    reads whichever store (sqlite fallback or postgres) the FastAPI
    ingestion pipeline is actually using — no separate configuration step.
    """

    upload_dir: str = os.getenv("UPLOAD_DIR", "uploads")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    pg_host: str = os.getenv("PGHOST", "localhost")
    pg_port: int = int(os.getenv("PGPORT", "5432"))
    pg_user: str = os.getenv("PGUSER", "postgres")
    pg_password: str = os.getenv("PGPASSWORD", "")
    pg_database: str = os.getenv("PGDATABASE", "postgres")
    # How long the in-memory chunk/embedding cache is trusted before a
    # workspace is re-read from storage. Keeps repeated voice turns fast
    # without ever going more than a few seconds stale after an upload.
    cache_ttl_seconds: float = float(os.getenv("DOC_RETRIEVAL_CACHE_TTL", "10"))
    embedding_model: str = os.getenv("DOC_EMBEDDING_MODEL", "gemini-embedding-2")
    embedding_dimension: int = int(os.getenv("DOC_EMBEDDING_DIM", "768"))


@dataclass
class RetrievedChunk:
    document_name: str
    content: str
    score: float
