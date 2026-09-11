"""HTTP endpoints for Gmail status/send (optional; voice agent is primary path)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.email import (
    GmailApiError,
    GmailConfigError,
    gmail_email_service,
    normalize_address_list,
    validate_recipients,
)
from ..services.session_audit import list_audit_events, log_email_event

router = APIRouter(prefix="/api/email", tags=["email"])


class SendEmailRequest(BaseModel):
    to: str | list[str]
    subject: str
    body: str
    cc: list[str] | str | None = None
    bcc: list[str] | str | None = None
    room_id: str | None = Field(default=None, alias="roomId")

    model_config = {"populate_by_name": True}


@router.get("/status")
async def email_status():
    return gmail_email_service.gmail_status()


@router.post("/send")
async def send_email(payload: SendEmailRequest):
    to = normalize_address_list(payload.to)
    cc = normalize_address_list(payload.cc)
    bcc = normalize_address_list(payload.bcc)
    try:
        validate_recipients(to=to, cc=cc, bcc=bcc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not gmail_email_service.is_configured():
        log_email_event(
            "EMAIL_SEND_FAILED",
            room_id=payload.room_id,
            recipient=", ".join(to),
            subject=payload.subject,
            error="Gmail not configured",
        )
        raise HTTPException(
            status_code=503,
            detail=gmail_email_service.gmail_status().get("error") or "Gmail not configured",
        )

    try:
        result = gmail_email_service.send_email(
            to=to,
            cc=cc,
            bcc=bcc,
            subject=payload.subject,
            body=payload.body,
        )
    except GmailConfigError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except GmailApiError as exc:
        log_email_event(
            "EMAIL_SEND_FAILED",
            room_id=payload.room_id,
            recipient=", ".join(to),
            subject=payload.subject,
            error=str(exc),
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    log_email_event(
        "EMAIL_SENT",
        room_id=payload.room_id,
        recipient=", ".join(to),
        subject=payload.subject,
        provider="gmail",
        provider_message_id=result.get("message_id"),
        details={"thread_id": result.get("thread_id"), "cc": cc, "bcc": bcc},
    )
    return result


@router.get("/audit")
async def email_audit(limit: int = 100):
    return list_audit_events(limit=limit)
