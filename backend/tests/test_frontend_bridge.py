"""Frontend bridge activity label + payload helper tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

VOICE_AGENT = Path(__file__).resolve().parents[2] / "voice-agent"
if str(VOICE_AGENT) not in sys.path:
    sys.path.insert(0, str(VOICE_AGENT))

from frontend_bridge import (  # noqa: E402
    STATE_ACTIVITY,
    activity_phase_for_tool,
    activity_text_for_tool,
)


@pytest.mark.parametrize(
    ("tool", "status", "expected"),
    [
        ("get_customers", "start", "Calling database tool"),
        ("list_invoices", "start", "Calling database tool"),
        ("count_claims", "start", "Calling database tool"),
        ("run_custom_read_query", "start", "Calling database tool"),
        ("get_customers", "done", "Database result received"),
        ("run_custom_read_query", "done", "Database result received"),
        ("search_documents", "start", "Searching uploaded documents"),
        ("search_documents", "done", "Document result received"),
        ("prepare_email", "start", "Preparing email"),
        ("prepare_email", "done", "Email draft ready"),
        ("confirm_email_details", "start", "Confirming email details"),
        ("confirm_email_details", "done", "Email confirmation received"),
        ("send_email", "start", "Sending email"),
        ("authorize_and_send_email", "start", "Sending email"),
        ("send_email", "done", "Email sent successfully"),
        ("send_email", "error", "Email operation failed"),
    ],
)
def test_activity_text_for_tool(tool: str, status: str, expected: str):
    assert activity_text_for_tool(tool, status) == expected


def test_activity_phase_for_tool():
    assert activity_phase_for_tool("search_documents") == "retrieval"
    assert activity_phase_for_tool("prepare_email") == "email"
    assert activity_phase_for_tool("get_customers") == "tool"
    assert activity_phase_for_tool("run_custom_read_query") == "tool"


def test_agent_state_activity_copy():
    assert STATE_ACTIVITY["listening"]["text"] == "Listening"
    assert STATE_ACTIVITY["thinking"]["text"] == "Processing request"
    assert STATE_ACTIVITY["speaking"]["text"] == "Preparing response"


def test_model_activity_payload_shape():
    """Payload shape expected by liveKitClient.ts model_activity handler."""
    tool = "search_documents"
    payload = {
        "type": "model_activity",
        "text": activity_text_for_tool(tool, "start"),
        "phase": activity_phase_for_tool(tool),
        "status": "start",
        "tool": tool,
    }
    assert payload["type"] == "model_activity"
    assert set(payload.keys()) >= {"type", "text", "phase", "status", "tool"}
    assert payload["text"] == "Searching uploaded documents"


def test_transcript_event_payload_shapes():
    user_payload = {"type": "user_transcript", "text": "hello", "final": True}
    agent_payload = {"type": "agent_transcript", "text": "hi there", "final": True}
    assert user_payload["type"] == "user_transcript"
    assert agent_payload["type"] == "agent_transcript"
    assert isinstance(agent_payload["final"], bool)
