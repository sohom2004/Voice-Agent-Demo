"""LiveKit function tools for Gmail email with a confirmation gate.

Flow: prepare_email → confirm_email_details → authorize_and_send_email
Draft mutations always invalidate prior send authorization.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

from livekit.agents import function_tool

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from frontend_bridge import (  # noqa: E402
    activity_phase_for_tool,
    activity_text_for_tool,
    get_room_name,
    note_tool_used,
    publish_event,
)

logger = logging.getLogger("voice-agent.email_tools")

_flow: Any = None


def _get_flow():
    global _flow
    from app.services.email_flow import EmailFlowController

    room_id = get_room_name()
    if _flow is None:
        _flow = EmailFlowController(room_id=room_id)
    else:
        _flow.draft.room_id = room_id or _flow.draft.room_id
    return _flow


def reset_email_flow(room_id: str | None = None) -> None:
    global _flow
    from app.services.email_flow import EmailFlowController

    _flow = EmailFlowController(room_id=room_id or get_room_name())


async def _activity(tool: str, status: str, text: str | None = None) -> None:
    note_tool_used(tool)
    await publish_event(
        {
            "type": "model_activity",
            "text": text or activity_text_for_tool(tool, status),
            "phase": activity_phase_for_tool(tool),
            "status": status,
            "tool": tool,
        }
    )


def _audit(event_type: str, draft: Any, error: str | None = None, **extra: Any) -> None:
    try:
        from app.services.session_audit import log_email_event

        log_email_event(
            event_type,
            room_id=getattr(draft, "room_id", None) or get_room_name(),
            recipient=", ".join(getattr(draft, "to", []) or []),
            subject=getattr(draft, "subject", None),
            provider="gmail",
            provider_message_id=getattr(draft, "provider_message_id", None),
            error=error,
            details={
                "cc": getattr(draft, "cc", []),
                "bcc": getattr(draft, "bcc", []),
                "state": getattr(getattr(draft, "state", None), "value", None),
                **extra,
            },
        )
    except Exception as exc:
        logger.debug("Email audit skipped: %s", exc)


def _draft_summary(draft: Any) -> str:
    cc = f" Cc: {', '.join(draft.cc)}." if draft.cc else ""
    bcc = f" Bcc: {', '.join(draft.bcc)}." if draft.bcc else ""
    preview = draft.body[:280] + ("…" if len(draft.body) > 280 else "")
    return (
        f"I can email {', '.join(draft.to)}.{cc}{bcc} "
        f"Subject: '{draft.subject}'. "
        f"Body: {preview}. "
        "Ask the caller to confirm these details, then ask for explicit send "
        "authorization before calling authorize_and_send_email."
    )


@function_tool
async def prepare_email(
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
) -> str:
    """Create or replace an email draft. Does NOT send.

    Use when the caller asks to email someone. After preparing, read back the
    recipient, subject, and a short body summary and ask if the details look right.
    Never send until authorize_and_send_email is called after an explicit yes.
    Changing any field invalidates prior send authorization.
    """
    await _activity("prepare_email", "start", "Preparing email")
    try:
        flow = _get_flow()
        draft = flow.prepare(to=to, subject=subject, body=body, cc=cc or None, bcc=bcc or None)
        flow.present()
        _audit("EMAIL_DRAFTED", draft)
        await _activity("prepare_email", "done", "Email draft ready")
        return json.dumps(
            {
                "status": "ok",
                "state": draft.state.value,
                "summary": _draft_summary(draft),
                "draft": draft.to_public_dict(),
            },
            default=str,
        )
    except Exception as exc:
        await _activity("prepare_email", "error", "Email operation failed")
        return json.dumps({"status": "error", "error": str(exc)})


@function_tool
async def confirm_email_details(
    confirmed: bool = True,
    to: str = "",
    subject: str = "",
    body: str = "",
    cc: str = "",
    bcc: str = "",
) -> str:
    """Confirm or revise email draft details. Does NOT send.

    If the caller changes recipient/subject/body/cc/bcc, pass the new values —
    that resets authorization. If details are correct, set confirmed=true and
    then ask: 'Would you like me to send it?'
    """
    await _activity("confirm_email_details", "start", "Confirming email details")
    try:
        flow = _get_flow()
        if any([to, subject, body, cc, bcc]):
            draft = flow.update_draft(
                to=to or None,
                subject=subject or None,
                body=body or None,
                cc=cc or None,
                bcc=bcc or None,
            )
            flow.present()
            _audit("EMAIL_DRAFTED", draft, details_note="updated")
            await _activity(
                "confirm_email_details",
                "done",
                "Email draft updated — reconfirmation required",
            )
            return json.dumps(
                {
                    "status": "ok",
                    "state": draft.state.value,
                    "summary": "Draft was changed; previous send authorization is void. "
                    + _draft_summary(draft),
                    "draft": draft.to_public_dict(),
                },
                default=str,
            )

        if not confirmed:
            await _activity("confirm_email_details", "done", "Email details not confirmed")
            return json.dumps(
                {
                    "status": "ok",
                    "state": flow.draft.state.value,
                    "summary": "Caller has not confirmed the email details yet.",
                }
            )

        draft = flow.confirm_details()
        flow.await_send_authorization()
        _audit("EMAIL_DETAILS_CONFIRMED", draft)
        await _activity("confirm_email_details", "done", "Email confirmation received")
        return json.dumps(
            {
                "status": "ok",
                "state": flow.draft.state.value,
                "summary": (
                    "Details confirmed. Ask for explicit send authorization "
                    "(for example 'Yes, send it'), then call authorize_and_send_email "
                    "with the caller's exact confirmation phrase."
                ),
                "draft": flow.draft.to_public_dict(),
            },
            default=str,
        )
    except Exception as exc:
        await _activity("confirm_email_details", "error", "Email operation failed")
        return json.dumps({"status": "error", "error": str(exc)})


@function_tool
async def authorize_and_send_email(user_confirmation: str) -> str:
    """Send the prepared email ONLY after explicit caller authorization.

    Pass the caller's exact confirmation phrase in user_confirmation.
    Accepts clear affirmations such as 'Yes', 'Send it', 'Go ahead'.
    Rejects 'No', 'Don't send', 'Wait', 'Not yet'.
    If the draft changed since confirmation, this fails until details are confirmed again.
    """
    await _activity("send_email", "start", "Sending email")
    flow = _get_flow()
    try:
        if flow.draft.state.value in {"DRAFTED", "PRESENTED", "DETAILS_CONFIRMED"}:
            flow.await_send_authorization()
        draft = flow.authorize(user_confirmation)
        _audit("EMAIL_SEND_AUTHORIZED", draft, confirmation=user_confirmation)
    except PermissionError as exc:
        await _activity("send_email", "error", "Email send not authorized")
        _audit("EMAIL_SEND_FAILED", flow.draft, error=str(exc))
        return json.dumps(
            {"status": "error", "error": str(exc), "state": flow.draft.state.value}
        )
    except Exception as exc:
        await _activity("send_email", "error", "Email operation failed")
        return json.dumps({"status": "error", "error": str(exc)})

    try:
        from app.services.email import GmailApiError, GmailConfigError, gmail_email_service

        if not gmail_email_service.is_configured():
            msg = (
                gmail_email_service.gmail_status().get("error")
                or "Gmail is not configured"
            )
            flow.mark_failed(msg)
            _audit("EMAIL_SEND_FAILED", flow.draft, error=msg)
            await _activity("send_email", "error", "Email not configured")
            return json.dumps({"status": "error", "error": msg, "configured": False})

        result = gmail_email_service.send_email(
            to=draft.to,
            cc=draft.cc,
            bcc=draft.bcc,
            subject=draft.subject,
            body=draft.body,
        )
        flow.mark_sent(
            message_id=result.get("message_id"),
            thread_id=result.get("thread_id"),
        )
        _audit(
            "EMAIL_SENT",
            flow.draft,
            provider_message_id=result.get("message_id"),
        )
        await _activity("send_email", "done", "Email sent successfully")
        return json.dumps(
            {
                "status": "ok",
                "state": flow.draft.state.value,
                "result": result,
                "summary": f"Email sent to {', '.join(draft.to)}.",
            },
            default=str,
        )
    except (GmailConfigError, GmailApiError, ValueError) as exc:
        flow.mark_failed(str(exc))
        _audit("EMAIL_SEND_FAILED", flow.draft, error=str(exc))
        await _activity("send_email", "error", "Email operation failed")
        return json.dumps(
            {"status": "error", "error": str(exc), "state": flow.draft.state.value}
        )
    except Exception as exc:
        flow.mark_failed(str(exc))
        _audit("EMAIL_SEND_FAILED", flow.draft, error=str(exc))
        await _activity("send_email", "error", "Email operation failed")
        return json.dumps({"status": "error", "error": str(exc)})


EMAIL_TOOLS = [prepare_email, confirm_email_details, authorize_and_send_email]
