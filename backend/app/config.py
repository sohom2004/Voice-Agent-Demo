from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

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


@dataclass
class Settings:
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "") or os.getenv("GOOGLE_API_KEY", "")
    google_api_key: str = os.getenv("GOOGLE_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")
    pg_host: str = os.getenv("PGHOST", "localhost")
    pg_port: int = int(os.getenv("PGPORT", "5432"))
    pg_user: str = os.getenv("PGUSER", "postgres")
    pg_password: str = os.getenv("PGPASSWORD", "")
    pg_database: str = os.getenv("PGDATABASE", "postgres")
    upload_dir: str = _resolve_path(os.getenv("UPLOAD_DIR", ""), _ROOT / "uploads")
    livekit_url: str = os.getenv("LIVEKIT_URL", "")
    livekit_api_key: str = os.getenv("LIVEKIT_API_KEY", "")
    livekit_api_secret: str = os.getenv("LIVEKIT_API_SECRET", "")
    sql_mcp_dialect: str = os.getenv("SQL_MCP_DIALECT", "sqlite")
    sql_mcp_host: str = os.getenv("SQL_MCP_HOST", "localhost")
    sql_mcp_port: int = int(os.getenv("SQL_MCP_PORT", "5432"))
    sql_mcp_user: str = os.getenv("SQL_MCP_USER", "postgres")
    sql_mcp_password: str = os.getenv("SQL_MCP_PASSWORD", "postgres")
    sql_mcp_database: str = _resolve_path(
        os.getenv("SQL_MCP_DATABASE", ""),
        _ROOT / "demo_database.db",
    )
    app_url: str = os.getenv("APP_URL", "http://localhost:3000")


settings = Settings()
