"""Lightweight email confirmation state machine for the voice agent.

AUTHORIZED is reached only after explicit user confirmation. Draft mutations
invalidate any prior send authorization.
"""

from __future__ import annotations

import re
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

from .email import is_valid_email, normalize_address_list, sanitize_subject


class EmailFlowState(str, Enum):
    IDLE = "IDLE"
    DRAFTED = "DRAFTED"
    PRESENTED = "PRESENTED"
    DETAILS_CONFIRMED = "DETAILS_CONFIRMED"
    AWAITING_SEND_AUTHORIZATION = "AWAITING_SEND_AUTHORIZATION"
    AUTHORIZED = "AUTHORIZED"
    SENT = "SENT"
    FAILED = "FAILED"


_AFFIRM_RE = re.compile(
    r"^\s*("
    r"yes([,!]?\s+(please\s+)?(send(\s+it)?|go\s+ahead|do\s+it))?"
    r"|yep|yeah|yup|ok|okay|sure"
    r"|please\s+send(\s+it)?"
    r"|send(\s+it)?"
    r"|go\s+ahead"
    r"|i\s+authorize(\s+sending(\s+it)?)?"
    r"|confirm(\s+send)?"
    r"|do\s+it|ship\s+it"
    r")\s*[.!?]?\s*$",
    re.IGNORECASE,
)
_DENY_RE = re.compile(
    r"\b(no|nope|don'?t\s+send|do\s+not\s+send|wait|not\s+yet|cancel|stop|"
    r"hold\s+on|never\s+mind|nevermind)\b",
    re.IGNORECASE,
)


def is_send_authorization(text: str) -> bool:
    """Deterministic authorization check — never treat denials as yes."""
    raw = (text or "").strip()
    if not raw:
        return False
    if _DENY_RE.search(raw):
        return False
    return bool(_AFFIRM_RE.match(raw))


def is_send_denial(text: str) -> bool:
    raw = (text or "").strip()
    if not raw:
        return False
    return bool(_DENY_RE.search(raw))


@dataclass
class EmailDraft:
    to: list[str] = field(default_factory=list)
    cc: list[str] = field(default_factory=list)
    bcc: list[str] = field(default_factory=list)
    subject: str = ""
    body: str = ""
    state: EmailFlowState = EmailFlowState.IDLE
    last_error: str | None = None
    provider_message_id: str | None = None
    provider_thread_id: str | None = None
    updated_at: float = field(default_factory=time.time)
    room_id: str | None = None

    def to_public_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["state"] = self.state.value
        return data


class EmailFlowController:
    """Per-session email draft + authorization gate."""

    def __init__(self, room_id: str | None = None) -> None:
        self.draft = EmailDraft(room_id=room_id)

    def _touch(self) -> None:
        self.draft.updated_at = time.time()

    def clear(self) -> None:
        room_id = self.draft.room_id
        self.draft = EmailDraft(room_id=room_id)

    def prepare(
        self,
        *,
        to: list[str] | str,
        subject: str,
        body: str,
        cc: list[str] | str | None = None,
        bcc: list[str] | str | None = None,
    ) -> EmailDraft:
        to_list = normalize_address_list(to)
        cc_list = normalize_address_list(cc)
        bcc_list = normalize_address_list(bcc)
        if not to_list:
            raise ValueError("At least one recipient is required")
        for addr in to_list + cc_list + bcc_list:
            if not is_valid_email(addr):
                raise ValueError(f"Invalid email address: {addr}")

        # Any draft mutation invalidates prior authorization.
        self.draft.to = to_list
        self.draft.cc = cc_list
        self.draft.bcc = bcc_list
        self.draft.subject = sanitize_subject(subject) or "Message from Natasha"
        self.draft.body = (body or "").strip()
        self.draft.state = EmailFlowState.DRAFTED
        self.draft.last_error = None
        self.draft.provider_message_id = None
        self.draft.provider_thread_id = None
        self._touch()
        return self.draft

    def present(self) -> EmailDraft:
        if self.draft.state == EmailFlowState.IDLE:
            raise ValueError("No email draft to present")
        if self.draft.state in {
            EmailFlowState.AUTHORIZED,
            EmailFlowState.SENT,
        }:
            # Presenting again after auth means we need a fresh confirmation.
            self.draft.state = EmailFlowState.PRESENTED
        elif self.draft.state == EmailFlowState.DRAFTED:
            self.draft.state = EmailFlowState.PRESENTED
        self._touch()
        return self.draft

    def update_draft(
        self,
        *,
        to: list[str] | str | None = None,
        subject: str | None = None,
        body: str | None = None,
        cc: list[str] | str | None = None,
        bcc: list[str] | str | None = None,
    ) -> EmailDraft:
        if self.draft.state == EmailFlowState.IDLE and to is None:
            raise ValueError("No email draft to update")

        if to is not None:
            self.draft.to = normalize_address_list(to)
        if cc is not None:
            self.draft.cc = normalize_address_list(cc)
        if bcc is not None:
            self.draft.bcc = normalize_address_list(bcc)
        if subject is not None:
            self.draft.subject = sanitize_subject(subject)
        if body is not None:
            self.draft.body = body.strip()

        for addr in self.draft.to + self.draft.cc + self.draft.bcc:
            if not is_valid_email(addr):
                raise ValueError(f"Invalid email address: {addr}")
        if not self.draft.to:
            raise ValueError("At least one recipient is required")

        # Critical invariant: draft mutation invalidates authorization.
        self.draft.state = EmailFlowState.DRAFTED
        self.draft.last_error = None
        self.draft.provider_message_id = None
        self.draft.provider_thread_id = None
        self._touch()
        return self.draft

    def confirm_details(self) -> EmailDraft:
        if self.draft.state not in {
            EmailFlowState.DRAFTED,
            EmailFlowState.PRESENTED,
            EmailFlowState.DETAILS_CONFIRMED,
            EmailFlowState.AWAITING_SEND_AUTHORIZATION,
            EmailFlowState.FAILED,
        }:
            if self.draft.state == EmailFlowState.IDLE:
                raise ValueError("No email draft to confirm")
            if self.draft.state == EmailFlowState.AUTHORIZED:
                # Confirming again after auth without mutation keeps awaiting? No —
                # details confirmation is earlier; keep authorized only if unchanged.
                pass
            elif self.draft.state == EmailFlowState.SENT:
                raise ValueError("Email already sent; prepare a new draft")

        if self.draft.state == EmailFlowState.AUTHORIZED:
            self._touch()
            return self.draft

        self.draft.state = EmailFlowState.DETAILS_CONFIRMED
        self._touch()
        return self.draft

    def await_send_authorization(self) -> EmailDraft:
        if self.draft.state not in {
            EmailFlowState.DETAILS_CONFIRMED,
            EmailFlowState.PRESENTED,
            EmailFlowState.DRAFTED,
            EmailFlowState.AWAITING_SEND_AUTHORIZATION,
        }:
            if self.draft.state == EmailFlowState.IDLE:
                raise ValueError("No email draft awaiting authorization")
            if self.draft.state == EmailFlowState.SENT:
                raise ValueError("Email already sent")
        # Details are treated as confirmed when we ask to send.
        if self.draft.state in {EmailFlowState.DRAFTED, EmailFlowState.PRESENTED}:
            self.draft.state = EmailFlowState.DETAILS_CONFIRMED
        self.draft.state = EmailFlowState.AWAITING_SEND_AUTHORIZATION
        self._touch()
        return self.draft

    def authorize(self, user_text: str) -> EmailDraft:
        if self.draft.state not in {
            EmailFlowState.AWAITING_SEND_AUTHORIZATION,
            EmailFlowState.DETAILS_CONFIRMED,
            EmailFlowState.PRESENTED,
        }:
            raise ValueError(
                f"Cannot authorize send from state {self.draft.state.value}"
            )
        if is_send_denial(user_text):
            self.draft.state = EmailFlowState.DETAILS_CONFIRMED
            self.draft.last_error = "Send declined by user"
            self._touch()
            raise PermissionError("User declined to send the email")
        if not is_send_authorization(user_text):
            raise PermissionError(
                "Explicit send authorization required (e.g. 'Yes, send it')"
            )
        self.draft.state = EmailFlowState.AUTHORIZED
        self.draft.last_error = None
        self._touch()
        return self.draft

    def mark_sent(self, *, message_id: str | None, thread_id: str | None = None) -> EmailDraft:
        if self.draft.state != EmailFlowState.AUTHORIZED:
            raise ValueError("Email send is not authorized")
        self.draft.state = EmailFlowState.SENT
        self.draft.provider_message_id = message_id
        self.draft.provider_thread_id = thread_id
        self.draft.last_error = None
        self._touch()
        return self.draft

    def mark_failed(self, error: str) -> EmailDraft:
        self.draft.state = EmailFlowState.FAILED
        self.draft.last_error = error
        # Failure also clears authorization so a retry requires re-auth.
        self._touch()
        return self.draft

    def can_send(self) -> bool:
        return self.draft.state == EmailFlowState.AUTHORIZED
