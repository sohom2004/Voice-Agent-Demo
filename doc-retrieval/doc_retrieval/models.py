from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import unquote, urlparse


def _pg_settings() -> dict[str, str]:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if url and not url.lower().startswith("sqlite"):
        parsed = urlparse(url)
        return {
            "host": parsed.hostname or "localhost",
            "port": str(parsed.port or 5432),
            "user": unquote(parsed.username or "postgres"),
            "password": unquote(parsed.password or ""),
            "database": unquote((parsed.path or "").lstrip("/") or "voice_agent"),
            "dsn": url,
        }
    return {
        "host": os.getenv("PGHOST", "localhost"),
        "port": os.getenv("PGPORT", "5432"),
        "user": os.getenv("PGUSER", "postgres"),
        "password": os.getenv("PGPASSWORD", ""),
        "database": os.getenv("PGDATABASE", "voice_agent"),
        "dsn": "",
    }


_PG = _pg_settings()


@dataclass
class RetrievalConfig:
    """Points at the same document store the ingestion worker writes to.

    Mirrors backend/app/config.py's env var names exactly so this package
    reads whichever store (sqlite fallback or postgres) the FastAPI
    ingestion pipeline is actually using — no separate configuration step.
    """

    upload_dir: str = os.getenv("UPLOAD_DIR", "uploads")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    pg_host: str = _PG["host"]
    pg_port: int = int(_PG["port"] or "5432")
    pg_user: str = _PG["user"]
    pg_password: str = _PG["password"]
    pg_database: str = _PG["database"]
    pg_dsn: str = _PG["dsn"]
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
