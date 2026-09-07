from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Settings:
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    pg_host: str = os.getenv("PGHOST", "localhost")
    pg_port: int = int(os.getenv("PGPORT", "5432"))
    pg_user: str = os.getenv("PGUSER", "postgres")
    pg_password: str = os.getenv("PGPASSWORD", "")
    pg_database: str = os.getenv("PGDATABASE", "postgres")
    upload_dir: str = os.getenv("UPLOAD_DIR", "uploads")
    livekit_url: str = os.getenv("LIVEKIT_URL", "")
    livekit_api_key: str = os.getenv("LIVEKIT_API_KEY", "")
    livekit_api_secret: str = os.getenv("LIVEKIT_API_SECRET", "")
    sql_mcp_dialect: str = os.getenv("SQL_MCP_DIALECT", "sqlite")
    sql_mcp_host: str = os.getenv("SQL_MCP_HOST", "localhost")
    sql_mcp_port: int = int(os.getenv("SQL_MCP_PORT", "5432"))
    sql_mcp_user: str = os.getenv("SQL_MCP_USER", "postgres")
    sql_mcp_password: str = os.getenv("SQL_MCP_PASSWORD", "postgres")
    sql_mcp_database: str = os.getenv("SQL_MCP_DATABASE", "demo_database.db")


settings = Settings()
