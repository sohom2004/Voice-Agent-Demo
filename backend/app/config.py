from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

from dotenv import load_dotenv

# Repo root .env, then optional backend/.env
_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / ".env")
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Keep Gemini / Google plugin env vars in sync.
_gemini = os.getenv("GEMINI_API_KEY", "")
_google = os.getenv("GOOGLE_API_KEY", "")
if _gemini and not _google:
    os.environ["GOOGLE_API_KEY"] = _gemini
if _google and not _gemini:
    os.environ["GEMINI_API_KEY"] = _google


def _resolve_path(value: str, default: Path) -> str:
    raw = (value or "").strip() or str(default)
    path = Path(raw)
    if not path.is_absolute():
        path = (_ROOT / path).resolve()
    return str(path)


def postgres_dsn(url: str) -> str:
    raw = (url or "").strip()
    if raw.startswith("postgres://"):
        return "postgresql://" + raw[len("postgres://") :]
    return raw


def _parse_database_url(url: str) -> dict[str, str]:
    parsed = urlparse(url.strip())
    return {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "user": unquote(parsed.username or "postgres"),
        "password": unquote(parsed.password or ""),
        "database": unquote((parsed.path or "").lstrip("/") or "voice_agent"),
        "dsn": url.strip(),
    }


def _pg_from_env() -> dict[str, str]:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if url and not url.lower().startswith("sqlite"):
        return _parse_database_url(url)
    return {
        "host": os.getenv("PGHOST", "localhost"),
        "port": os.getenv("PGPORT", "5432"),
        "user": os.getenv("PGUSER", "postgres"),
        "password": os.getenv("PGPASSWORD", ""),
        "database": os.getenv("PGDATABASE", "voice_agent"),
        "dsn": "",
    }


_pg = _pg_from_env()
_sql_dialect = (os.getenv("SQL_MCP_DIALECT") or "").strip() or (
    "postgresql" if (os.getenv("DATABASE_URL") or os.getenv("SQL_MCP_DATABASE_URL")) else "postgresql"
)


@dataclass
class Settings:
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
    google_api_key: str = os.getenv("GOOGLE_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")
    database_url: str = (os.getenv("DATABASE_URL") or os.getenv("SQL_MCP_DATABASE_URL") or "").strip()
    pg_host: str = _pg["host"]
    pg_port: int = int(_pg["port"] or "5432")
    pg_user: str = _pg["user"]
    pg_password: str = _pg["password"]
    pg_database: str = _pg["database"]
    pg_dsn: str = _pg["dsn"]
    upload_dir: str = _resolve_path(os.getenv("UPLOAD_DIR", ""), _ROOT / "uploads")
    livekit_url: str = os.getenv("LIVEKIT_URL", "")
    livekit_api_key: str = os.getenv("LIVEKIT_API_KEY", "")
    livekit_api_secret: str = os.getenv("LIVEKIT_API_SECRET", "")
    sql_mcp_dialect: str = _sql_dialect
    sql_mcp_host: str = os.getenv("SQL_MCP_HOST") or _pg["host"]
    sql_mcp_port: int = int(os.getenv("SQL_MCP_PORT") or _pg["port"] or "5432")
    sql_mcp_user: str = os.getenv("SQL_MCP_USER") or _pg["user"]
    sql_mcp_password: str = os.getenv("SQL_MCP_PASSWORD") or _pg["password"]
    sql_mcp_database: str = os.getenv("SQL_MCP_DATABASE") or _pg["database"]
    sql_mcp_schema: str = os.getenv("SQL_MCP_SCHEMA", "business")
    sql_mcp_database_url: str = (os.getenv("SQL_MCP_DATABASE_URL") or os.getenv("DATABASE_URL") or "").strip()
    app_url: str = os.getenv("APP_URL", "http://localhost:3000")
    app_env: str = os.getenv("APP_ENV", "development")
    gmail_client_id: str = os.getenv("GMAIL_CLIENT_ID", "")
    gmail_client_secret: str = os.getenv("GMAIL_CLIENT_SECRET", "")
    gmail_refresh_token: str = os.getenv("GMAIL_REFRESH_TOKEN", "")
    gmail_user_email: str = os.getenv("GMAIL_USER_EMAIL", "")


settings = Settings()
