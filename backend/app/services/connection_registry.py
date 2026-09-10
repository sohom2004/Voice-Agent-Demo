"""Server-local persistence for active sql-mcp database connections.

The JSON file at ``<repo>/.sqlmcp/active_connections.json`` may contain
secrets so the voice agent (and other local processes) can reuse the same
connection the HTTP API configured. Never expose this file or its contents
via public API responses.
"""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path
from typing import Any

# repo root: services -> app -> backend -> root
REPO_ROOT = Path(__file__).resolve().parents[3]
SQLMCP_DIR = REPO_ROOT / ".sqlmcp"
ACTIVE_CONNECTIONS_PATH = SQLMCP_DIR / "active_connections.json"

_SQL_MCP_ROOT = REPO_ROOT / "sql-mcp"
if str(_SQL_MCP_ROOT) not in sys.path:
    sys.path.insert(0, str(_SQL_MCP_ROOT))

from sql_mcp.models import ConnectionConfig  # noqa: E402

_file_lock = threading.Lock()


def _read_all() -> dict[str, Any]:
    if not ACTIVE_CONNECTIONS_PATH.exists():
        return {}
    try:
        raw = json.loads(ACTIVE_CONNECTIONS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def _write_all(data: dict[str, Any]) -> None:
    SQLMCP_DIR.mkdir(parents=True, exist_ok=True)
    ACTIVE_CONNECTIONS_PATH.write_text(
        json.dumps(data, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def load_persisted_connection(tenant_id: str) -> ConnectionConfig | None:
    """Load a workspace's persisted connection config, or None."""
    with _file_lock:
        data = _read_all()
    entry = data.get(tenant_id)
    if not isinstance(entry, dict):
        return None
    try:
        return ConnectionConfig.from_dict({**entry, "tenantId": tenant_id})
    except (TypeError, ValueError):
        return None


def get_active_config_for_voice(tenant_id: str) -> ConnectionConfig | None:
    """Alias for voice-agent import: same as ``load_persisted_connection``."""
    return load_persisted_connection(tenant_id)


def save_persisted_connection(config: ConnectionConfig) -> None:
    """Persist (or overwrite) an active connection for a workspace."""
    with _file_lock:
        data = _read_all()
        data[config.tenant_id] = config.to_storage_dict()
        _write_all(data)


def clear_persisted_connection(tenant_id: str) -> None:
    """Remove a workspace's persisted connection, if present."""
    with _file_lock:
        data = _read_all()
        if tenant_id in data:
            del data[tenant_id]
            _write_all(data)


def list_persisted_tenant_ids() -> list[str]:
    with _file_lock:
        return list(_read_all().keys())
