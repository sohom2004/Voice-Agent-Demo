"""SQLite-backed audit log for email operations and completed model responses.

Never stores OAuth credentials or private chain-of-thought.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_DB = _REPO_ROOT / ".sqlmcp" / "session_audit.db"

_lock = threading.Lock()
_db_path: Path = _DEFAULT_DB


def configure_audit_db(path: str | Path | None = None) -> Path:
    global _db_path
    _db_path = Path(path) if path else _DEFAULT_DB
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    _ensure_schema(_db_path)
    return _db_path


def _connect(path: Path | None = None) -> sqlite3.Connection:
    db = Path(path) if path else _db_path
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema(path: Path | None = None) -> None:
    with _lock:
        conn = _connect(path)
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS email_audit (
                    id TEXT PRIMARY KEY,
                    created_at REAL NOT NULL,
                    event_type TEXT NOT NULL,
                    room_id TEXT,
                    recipient TEXT,
                    subject TEXT,
                    provider TEXT,
                    provider_message_id TEXT,
                    error TEXT,
                    details_json TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_email_audit_created
                    ON email_audit(created_at DESC);

                CREATE TABLE IF NOT EXISTS model_response_log (
                    id TEXT PRIMARY KEY,
                    created_at REAL NOT NULL,
                    room_id TEXT,
                    user_transcript TEXT,
                    assistant_response TEXT,
                    tools_json TEXT,
                    latency_seconds REAL,
                    model_name TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_model_response_created
                    ON model_response_log(created_at DESC);
                """
            )
            conn.commit()
        finally:
            conn.close()


def log_email_event(
    event_type: str,
    *,
    room_id: str | None = None,
    recipient: str | None = None,
    subject: str | None = None,
    provider: str | None = "gmail",
    provider_message_id: str | None = None,
    error: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _ensure_schema()
    entry = {
        "id": f"email_{uuid.uuid4().hex[:12]}",
        "created_at": time.time(),
        "event_type": event_type,
        "room_id": room_id,
        "recipient": recipient,
        "subject": subject,
        "provider": provider,
        "provider_message_id": provider_message_id,
        "error": error,
        "details_json": json.dumps(details or {}, default=str),
    }
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO email_audit (
                    id, created_at, event_type, room_id, recipient, subject,
                    provider, provider_message_id, error, details_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["id"],
                    entry["created_at"],
                    entry["event_type"],
                    entry["room_id"],
                    entry["recipient"],
                    entry["subject"],
                    entry["provider"],
                    entry["provider_message_id"],
                    entry["error"],
                    entry["details_json"],
                ),
            )
            conn.commit()
        finally:
            conn.close()
    return entry


def log_model_response(
    *,
    room_id: str | None,
    user_transcript: str | None,
    assistant_response: str,
    tools_used: list[str] | None = None,
    latency_seconds: float | None = None,
    model_name: str | None = None,
) -> dict[str, Any]:
    _ensure_schema()
    entry = {
        "id": f"resp_{uuid.uuid4().hex[:12]}",
        "created_at": time.time(),
        "room_id": room_id,
        "user_transcript": user_transcript or "",
        "assistant_response": assistant_response,
        "tools_json": json.dumps(tools_used or [], default=str),
        "latency_seconds": latency_seconds,
        "model_name": model_name,
    }
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO model_response_log (
                    id, created_at, room_id, user_transcript, assistant_response,
                    tools_json, latency_seconds, model_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry["id"],
                    entry["created_at"],
                    entry["room_id"],
                    entry["user_transcript"],
                    entry["assistant_response"],
                    entry["tools_json"],
                    entry["latency_seconds"],
                    entry["model_name"],
                ),
            )
            conn.commit()
        finally:
            conn.close()
    return entry


def list_audit_events(limit: int = 200) -> list[dict[str, Any]]:
    """Return merged email + model response events for the debug terminal."""
    _ensure_schema()
    limit = max(1, min(int(limit), 500))
    events: list[dict[str, Any]] = []
    with _lock:
        conn = _connect()
        try:
            for row in conn.execute(
                "SELECT * FROM email_audit ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ):
                ts = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(row["created_at"]))
                events.append(
                    {
                        "id": row["id"],
                        "timestamp": ts,
                        "type": row["event_type"],
                        "source": "email",
                        "message": f"{row['event_type']}: {row['subject'] or ''}".strip(),
                        "details": {
                            "room_id": row["room_id"],
                            "recipient": row["recipient"],
                            "subject": row["subject"],
                            "provider": row["provider"],
                            "provider_message_id": row["provider_message_id"],
                            "error": row["error"],
                            "extra": json.loads(row["details_json"] or "{}"),
                        },
                        "created_at": row["created_at"],
                    }
                )
            for row in conn.execute(
                "SELECT * FROM model_response_log ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ):
                ts = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(row["created_at"]))
                tools = json.loads(row["tools_json"] or "[]")
                latency = row["latency_seconds"]
                msg = "MODEL RESPONSE"
                if latency is not None:
                    msg = f"MODEL RESPONSE (latency {latency:.1f}s)"
                events.append(
                    {
                        "id": row["id"],
                        "timestamp": ts,
                        "type": "SPEECH_TRANSCRIPTION",
                        "source": "natasha_voice",
                        "message": msg,
                        "details": {
                            "room_id": row["room_id"],
                            "user_transcript": row["user_transcript"],
                            "assistant_response": row["assistant_response"],
                            "tools_used": tools,
                            "latency_seconds": latency,
                            "model_name": row["model_name"],
                        },
                        "created_at": row["created_at"],
                    }
                )
        finally:
            conn.close()
    events.sort(key=lambda e: e.get("created_at", 0), reverse=True)
    return events[:limit]
