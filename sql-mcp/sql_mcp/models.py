from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal
from urllib.parse import unquote, urlparse


Dialect = Literal["postgres", "mysql", "sqlite"]

_DEMO_SQLITE_NAMES = {"demo_database.db", "./demo_database.db"}


@dataclass
class ConnectionConfig:
    """Database connection settings for a workspace/tenant.

    Accepts either structured fields or a connection URL / connection string.
    Secrets must never be returned to the frontend — use ``redacted_dict``.
    """

    tenant_id: str = "default_tenant"
    dialect: Dialect = "sqlite"
    host: str = "localhost"
    port: int = 5432
    user: str = "postgres"
    password: str = "postgres"
    database: str = "demo_database.db"
    connection_url: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConnectionConfig":
        raw = dict(data or {})
        # Workspace isolation: workspaceId and tenantId are treated as the same key.
        tenant_id = (
            raw.get("tenantId")
            or raw.get("tenant_id")
            or raw.get("workspaceId")
            or raw.get("workspace_id")
            or "default_tenant"
        )
        connection_url = (
            raw.get("connectionUrl")
            or raw.get("connection_url")
            or raw.get("url")
            or raw.get("connectionString")
            or raw.get("connection_string")
        )
        cfg = cls(
            tenant_id=str(tenant_id),
            dialect=_normalize_dialect(raw.get("dialect", "sqlite")),
            host=raw.get("host", "localhost"),
            port=int(raw.get("port", 5432) or 5432),
            user=raw.get("user", "postgres"),
            password=raw.get("password", "postgres"),
            database=raw.get("database", "demo_database.db"),
            connection_url=connection_url,
        )
        if connection_url:
            cfg = cfg.merge_url(connection_url)
            cfg.tenant_id = str(tenant_id)
        return cfg

    def merge_url(self, url: str) -> "ConnectionConfig":
        parsed = _parse_connection_url(url)
        return ConnectionConfig(
            tenant_id=self.tenant_id,
            dialect=parsed.get("dialect", self.dialect),
            host=parsed.get("host", self.host),
            port=int(parsed.get("port", self.port)),
            user=parsed.get("user", self.user),
            password=parsed.get("password", self.password),
            database=parsed.get("database", self.database),
            connection_url=url,
        )

    def is_demo_sqlite(self) -> bool:
        if self.dialect != "sqlite":
            return False
        name = self.database.replace("\\", "/").split("/")[-1]
        return name in _DEMO_SQLITE_NAMES or self.database.endswith("/demo_database.db")

    def redacted_dict(self) -> dict[str, Any]:
        return {
            "tenantId": self.tenant_id,
            "workspaceId": self.tenant_id,
            "dialect": self.dialect,
            "host": self.host if self.dialect != "sqlite" else None,
            "port": self.port if self.dialect != "sqlite" else None,
            "user": self.user if self.dialect != "sqlite" else None,
            "database": self.database,
            "hasPassword": bool(self.password),
            "connectionUrlConfigured": bool(self.connection_url),
        }

    def to_storage_dict(self) -> dict[str, Any]:
        """Server-local persistence only — includes secrets."""
        return {
            "tenantId": self.tenant_id,
            "dialect": self.dialect,
            "host": self.host,
            "port": self.port,
            "user": self.user,
            "password": self.password,
            "database": self.database,
            "connectionUrl": self.connection_url,
        }


def _normalize_dialect(value: Any) -> Dialect:
    raw = str(value or "sqlite").strip().lower()
    if raw in {"postgres", "postgresql", "pg"}:
        return "postgres"
    if raw in {"mysql", "mariadb"}:
        return "mysql"
    if raw in {"sqlite", "sqlite3"}:
        return "sqlite"
    raise ValueError(f"Unsupported dialect: {value}")


def _parse_connection_url(url: str) -> dict[str, Any]:
    raw = (url or "").strip()
    if not raw:
        raise ValueError("connectionUrl is empty")

    # sqlite:///relative/path.db  or  sqlite:////absolute/path.db
    if raw.startswith("sqlite:"):
        # urlparse treats sqlite:///foo as path /foo
        parsed = urlparse(raw)
        path = unquote(parsed.path or "")
        if raw.startswith("sqlite:////"):
            # sqlite:////abs/path -> path becomes //abs/path; normalize
            path = "/" + path.lstrip("/")
        elif path.startswith("/") and not raw.startswith("sqlite:////"):
            # sqlite:///rel.db -> /rel.db means relative rel.db for our purposes
            # unless it looks like an absolute filesystem path with more segments
            # Keep leading slash only for absolute-looking multi-segment paths on Unix
            # when users pass sqlite:////abs. Prefer stripping single leading slash
            # for sqlite:///demo_database.db (common relative form).
            if path.count("/") == 1:
                path = path.lstrip("/")
        if not path:
            raise ValueError("SQLite connection URL must include a database path")
        return {"dialect": "sqlite", "database": path, "host": "", "port": 0, "user": "", "password": ""}

    parsed = urlparse(raw)
    scheme = (parsed.scheme or "").lower()
    if scheme in {"postgres", "postgresql"}:
        dialect: Dialect = "postgres"
        default_port = 5432
    elif scheme in {"mysql", "mariadb"}:
        dialect = "mysql"
        default_port = 3306
    else:
        raise ValueError(f"Unsupported connection URL scheme: {scheme or '(none)'}")

    database = unquote((parsed.path or "").lstrip("/"))
    if not database:
        raise ValueError("Connection URL must include a database name")

    return {
        "dialect": dialect,
        "host": parsed.hostname or "localhost",
        "port": int(parsed.port or default_port),
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": database,
    }


def redact_secrets(value: Any) -> Any:
    """Recursively redact password-like fields for logs and API responses."""
    sensitive = {
        "password",
        "passwd",
        "pwd",
        "secret",
        "token",
        "api_key",
        "apikey",
        "connectionurl",
        "connection_url",
        "connectionstring",
        "connection_string",
        "url",
    }
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if str(key).lower().replace("-", "_") in sensitive or "password" in str(key).lower():
                out[key] = "***REDACTED***"
            else:
                out[key] = redact_secrets(item)
        return out
    if isinstance(value, list):
        return [redact_secrets(item) for item in value]
    return value


@dataclass
class ColumnMeta:
    name: str
    data_type: str
    is_nullable: bool = True
    is_primary_key: bool = False
    is_foreign_key: bool = False
    references_table: str | None = None
    references_column: str | None = None


@dataclass
class TableMeta:
    name: str
    columns: list[ColumnMeta] = field(default_factory=list)


@dataclass
class SchemaSnapshot:
    tenant_id: str
    dialect: str
    schema_hash: str
    fetched_at: str
    tables: list[TableMeta] = field(default_factory=list)

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "tenantId": self.tenant_id,
            "dialect": self.dialect,
            "schemaHash": self.schema_hash,
            "fetchedAt": self.fetched_at,
            "tableCount": len(self.tables),
            "tables": [
                {
                    "name": table.name,
                    "columnCount": len(table.columns),
                    "columns": [asdict(col) for col in table.columns],
                }
                for table in self.tables
            ],
        }
