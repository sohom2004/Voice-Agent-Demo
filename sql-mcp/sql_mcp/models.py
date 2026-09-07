from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


Dialect = Literal["postgres", "mysql", "sqlite"]


@dataclass
class ConnectionConfig:
    tenant_id: str = "default_tenant"
    dialect: Dialect = "sqlite"
    host: str = "localhost"
    port: int = 5432
    user: str = "postgres"
    password: str = "postgres"
    database: str = "demo_database.db"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ConnectionConfig":
        return cls(
            tenant_id=data.get("tenantId") or data.get("tenant_id") or "default_tenant",
            dialect=data.get("dialect", "sqlite"),
            host=data.get("host", "localhost"),
            port=int(data.get("port", 5432)),
            user=data.get("user", "postgres"),
            password=data.get("password", "postgres"),
            database=data.get("database", "demo_database.db"),
        )


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
