"""LiveKit room data-channel bridge for frontend VoiceEvent payloads.

Publishes only observable status/transcript events — never private chain-of-thought,
system prompts, or credentials.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

logger = logging.getLogger("voice-agent.frontend_bridge")

# Session-scoped room reference set by the agent entrypoint.
_active_room: Any | None = None
_active_room_name: str | None = None
_last_user_transcript: str = ""
_tools_used_this_turn: list[str] = []
_turn_started_at: float | None = None


def set_active_room(room: Any | None) -> None:
    global _active_room, _active_room_name
    _active_room = room
    _active_room_name = getattr(room, "name", None) if room is not None else None


def get_room_name() -> str | None:
    return _active_room_name


def get_last_user_transcript() -> str:
    return _last_user_transcript


def note_tool_used(tool_name: str) -> None:
    if tool_name and tool_name not in _tools_used_this_turn:
        _tools_used_this_turn.append(tool_name)


def reset_turn_tools() -> list[str]:
    global _tools_used_this_turn
    used = list(_tools_used_this_turn)
    _tools_used_this_turn = []
    return used


async def publish_frontend_event(ctx: Any | None, payload: dict[str, Any]) -> None:
    """Serialize a small JSON payload onto the LiveKit room data channel."""
    room = None
    if ctx is not None:
        room = getattr(ctx, "room", None)
    if room is None:
        room = _active_room
    if room is None:
        return
    try:
        local = getattr(room, "local_participant", None)
        if local is None:
            return
        data = json.dumps(payload, default=str).encode("utf-8")
        await local.publish_data(data, reliable=True)
    except Exception as exc:
        logger.debug("Frontend event publish failed: %s", exc)


async def publish_event(payload: dict[str, Any]) -> None:
    await publish_frontend_event(None, payload)


def schedule_publish(payload: dict[str, Any]) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(publish_event(payload))


def activity_text_for_tool(tool_name: str, status: str) -> str:
    """Human-readable activity copy for the MODEL ACTIVITY feed."""
    name = (tool_name or "").strip()
    if status == "start":
        if name in {"run_custom_read_query", "execute_read"} or name.startswith(
            ("get_", "list_", "count_")
        ):
            return "Calling database tool"
        if name == "search_documents" or name.startswith("search_"):
            return "Searching uploaded documents"
        if "email" in name:
            if name.startswith("prepare"):
                return "Preparing email"
            if name.startswith("confirm"):
                return "Confirming email details"
            if "send" in name or "authorize" in name:
                return "Sending email"
            return "Working on email"
        if "ticket" in name:
            return "Working on ticket"
        return f"Running {name.replace('_', ' ')}" if name else "Running tool"
    # done / error
    if name in {"run_custom_read_query", "execute_read"} or name.startswith(
        ("get_", "list_", "count_")
    ):
        return "Database result received"
    if name == "search_documents" or name.startswith("search_"):
        return "Document result received"
    if "email" in name:
        if status == "error":
            return "Email operation failed"
        if "send" in name:
            return "Email sent successfully"
        if "prepare" in name:
            return "Email draft ready"
        if "confirm" in name:
            return "Email confirmation received"
        return "Email step completed"
    if "ticket" in name:
        return "Ticket action completed"
    return f"{name.replace('_', ' ')} completed" if name else "Tool completed"


def activity_phase_for_tool(tool_name: str) -> str:
    name = tool_name or ""
    if name == "search_documents" or name.startswith("search_"):
        return "retrieval"
    if "email" in name:
        return "email"
    if name.startswith(("get_", "list_", "count_", "run_custom", "execute_")):
        return "tool"
    return "tool"


STATE_ACTIVITY: dict[str, dict[str, str]] = {
    "listening": {"text": "Listening", "phase": "listening", "status": "active"},
    "thinking": {"text": "Processing request", "phase": "thinking", "status": "active"},
    "speaking": {"text": "Preparing response", "phase": "speaking", "status": "active"},
}


def _item_text(item: Any) -> str:
    if item is None:
        return ""
    text = getattr(item, "text_content", None)
    if isinstance(text, str) and text.strip():
        return text.strip()
    raw = getattr(item, "raw_text_content", None)
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    content = getattr(item, "content", None)
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str) and part.strip():
                parts.append(part.strip())
            else:
                transcript = getattr(part, "transcript", None)
                if isinstance(transcript, str) and transcript.strip():
                    parts.append(transcript.strip())
        if parts:
            return "\n".join(parts)
    return ""


def _metrics_latency(item: Any) -> float | None:
    metrics = getattr(item, "metrics", None)
    if not metrics:
        return None
    if isinstance(metrics, dict):
        for key in ("e2e_latency", "llm_node_ttft", "end_of_turn_delay"):
            val = metrics.get(key)
            if isinstance(val, (int, float)):
                return float(val)
        return None
    for key in ("e2e_latency", "llm_node_ttft", "end_of_turn_delay"):
        val = metrics.get(key) if hasattr(metrics, "get") else getattr(metrics, key, None)
        if isinstance(val, (int, float)):
            return float(val)
    return None


def wire_session_events(session: Any, *, model_name: str = "") -> None:
    """Attach LiveKit AgentSession handlers that forward events to the frontend."""
    if session is None or not hasattr(session, "on"):
        return

    def _on_user_input_transcribed(ev: Any) -> None:
        global _last_user_transcript, _turn_started_at
        transcript = (getattr(ev, "transcript", None) or "").strip()
        if not transcript:
            return
        is_final = bool(getattr(ev, "is_final", True))
        if is_final:
            _last_user_transcript = transcript
            import time

            _turn_started_at = time.time()
            reset_turn_tools()
        schedule_publish(
            {
                "type": "user_transcript",
                "text": transcript,
                "final": is_final,
            }
        )

    def _on_conversation_item_added(ev: Any) -> None:
        global _last_user_transcript
        item = getattr(ev, "item", None)
        if item is None:
            return
        # Only ChatMessage-like items with a role.
        role = getattr(item, "role", None)
        if role not in ("user", "assistant"):
            return
        text = _item_text(item)
        if not text:
            return

        if role == "user":
            # Prefer streaming STT events; only backfill if we never saw this utterance.
            if text != _last_user_transcript:
                _last_user_transcript = text
                schedule_publish(
                    {"type": "user_transcript", "text": text, "final": True}
                )
            return

        # Assistant completed message — authoritative MODEL RESPONSE source.
        schedule_publish(
            {
                "type": "agent_transcript",
                "text": text,
                "final": True,
            }
        )
        # Structured response log (no private CoT).
        try:
            from app.services.session_audit import log_model_response

            tools = reset_turn_tools()
            log_model_response(
                room_id=get_room_name(),
                user_transcript=_last_user_transcript,
                assistant_response=text,
                tools_used=tools,
                latency_seconds=_metrics_latency(item),
                model_name=model_name,
            )
        except Exception as exc:
            logger.debug("Model response audit log skipped: %s", exc)

        latency = _metrics_latency(item)
        if latency is not None:
            schedule_publish(
                {
                    "type": "model_activity",
                    "text": f"Latency: {latency:.1f}s",
                    "phase": "metrics",
                    "status": "done",
                }
            )

    def _on_agent_state_changed(ev: Any) -> None:
        new_state = getattr(ev, "new_state", None)
        if not new_state:
            return
        info = STATE_ACTIVITY.get(str(new_state))
        if not info:
            return
        # Avoid noisy "Preparing response" spam if we already said it this turn —
        # frontend can dedupe identical consecutive activities if needed.
        schedule_publish(
            {
                "type": "model_activity",
                "text": info["text"],
                "phase": info["phase"],
                "status": info["status"],
            }
        )

    def _on_function_tools_executed(ev: Any) -> None:
        calls = getattr(ev, "function_calls", None) or []
        outputs = getattr(ev, "function_call_outputs", None) or []
        zipped = None
        if hasattr(ev, "zipped"):
            try:
                zipped = ev.zipped()
            except Exception:
                zipped = None
        pairs = zipped if zipped is not None else list(zip(calls, outputs))
        for call, output in pairs:
            name = getattr(call, "name", None) or getattr(output, "name", None) or "tool"
            note_tool_used(str(name))
            is_error = bool(getattr(output, "is_error", False))
            # Tool wrappers already emit start/done; emit a compact completion
            # only when wrappers did not (name unknown to wrappers). Skip to
            # avoid duplicates for tools that publish themselves.
            # Kept as a no-op for known tools — wrappers handle activity.
            _ = is_error

    def _on_speech_created(ev: Any) -> None:
        source = getattr(ev, "source", None)
        if source:
            schedule_publish(
                {
                    "type": "model_activity",
                    "text": "Preparing response",
                    "phase": "speaking",
                    "status": "start",
                    "tool": str(source),
                }
            )

    for event_name, handler in (
        ("user_input_transcribed", _on_user_input_transcribed),
        ("conversation_item_added", _on_conversation_item_added),
        ("agent_state_changed", _on_agent_state_changed),
        ("function_tools_executed", _on_function_tools_executed),
        ("speech_created", _on_speech_created),
    ):
        try:
            session.on(event_name)(handler)
        except TypeError:
            try:
                session.on(event_name, handler)
            except Exception:
                logger.debug("Could not bind session event %s", event_name)
        except Exception:
            logger.debug("Could not bind session event %s", event_name)
