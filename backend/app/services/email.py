"""Gmail API email transport via OAuth refresh tokens (HTTPS only, no Azure)."""

from __future__ import annotations

import base64
import logging
import os
import re
import time
from email.message import EmailMessage
from typing import Any
from urllib import error, parse, request

logger = logging.getLogger("gmail_email")

TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")


class GmailConfigError(RuntimeError):
    """Raised when Gmail OAuth env vars are missing or incomplete."""


class GmailApiError(RuntimeError):
    """Raised when the Gmail API returns an error response."""

    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def is_valid_email(address: str) -> bool:
    addr = (address or "").strip()
    if not addr or len(addr) > 254:
        return False
    return bool(EMAIL_RE.match(addr))


def sanitize_subject(subject: str) -> str:
    return (subject or "").replace("\r", " ").replace("\n", " ").strip()


def normalize_address_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(",")]
        return [p for p in parts if p]
    if isinstance(value, (list, tuple)):
        out: list[str] = []
        for item in value:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                out.append(text)
        return out
    return [str(value).strip()] if str(value).strip() else []


def validate_recipients(*, to: list[str], cc: list[str] | None = None, bcc: list[str] | None = None) -> None:
    if not to:
        raise ValueError("At least one 'to' recipient is required")
    for label, addrs in (("to", to), ("cc", cc or []), ("bcc", bcc or [])):
        for addr in addrs:
            if not is_valid_email(addr):
                raise ValueError(f"Invalid {label} email address: {addr}")


def build_mime_message(
    *,
    sender: str,
    to: list[str],
    subject: str,
    body: str,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
) -> EmailMessage:
    validate_recipients(to=to, cc=cc, bcc=bcc)
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    if bcc:
        msg["Bcc"] = ", ".join(bcc)
    msg["Subject"] = sanitize_subject(subject)
    msg.set_content(body or "")
    return msg


def encode_raw_mime(message: EmailMessage) -> str:
    raw = message.as_bytes()
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _http_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    form: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict[str, Any] | list[Any] | str]:
    data: bytes | None = None
    req_headers = dict(headers or {})
    if form is not None:
        data = parse.urlencode(form).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    elif json_body is not None:
        import json as _json

        data = _json.dumps(json_body).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")

    req = request.Request(url, data=data, headers=req_headers, method=method.upper())
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200)
            raw = resp.read().decode("utf-8")
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            import json as _json

            parsed: Any = _json.loads(body) if body else {}
        except Exception:
            parsed = body
        return int(exc.code), parsed
    except error.URLError as exc:
        raise GmailApiError(f"Network error contacting Gmail API: {exc.reason}") from exc

    if not raw:
        return int(status), {}
    try:
        import json as _json

        return int(status), _json.loads(raw)
    except Exception:
        return int(status), raw


class GmailEmailService:
    """OAuth-backed Gmail send helper with in-memory access-token cache."""

    def __init__(
        self,
        *,
        client_id: str | None = None,
        client_secret: str | None = None,
        refresh_token: str | None = None,
        user_email: str | None = None,
        token_url: str = TOKEN_URL,
        api_base: str = GMAIL_API_BASE,
    ) -> None:
        self.client_id = (client_id if client_id is not None else os.getenv("GMAIL_CLIENT_ID", "")).strip()
        self.client_secret = (
            client_secret if client_secret is not None else os.getenv("GMAIL_CLIENT_SECRET", "")
        ).strip()
        self.refresh_token = (
            refresh_token if refresh_token is not None else os.getenv("GMAIL_REFRESH_TOKEN", "")
        ).strip()
        self.user_email = (
            user_email if user_email is not None else os.getenv("GMAIL_USER_EMAIL", "")
        ).strip()
        self.token_url = token_url
        self.api_base = api_base.rstrip("/")
        self._access_token: str | None = None
        self._expires_at: float = 0.0

    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.refresh_token and self.user_email)

    def gmail_status(self) -> dict[str, Any]:
        """Safe preflight info — never returns credentials."""
        if not self.is_configured():
            return {
                "configured": False,
                "authenticated_email": None,
                "error": "Gmail is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_USER_EMAIL.",
            }
        return {
            "configured": True,
            "authenticated_email": self.user_email,
        }

    def require_configured(self) -> None:
        if not self.is_configured():
            raise GmailConfigError(
                "Gmail is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, "
                "GMAIL_REFRESH_TOKEN, and GMAIL_USER_EMAIL."
            )

    def get_access_token(self, *, force_refresh: bool = False) -> str:
        self.require_configured()
        now = time.time()
        if (
            not force_refresh
            and self._access_token
            and now < (self._expires_at - 60)
        ):
            return self._access_token

        status, payload = _http_json(
            "POST",
            self.token_url,
            form={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": self.refresh_token,
                "grant_type": "refresh_token",
            },
        )
        if status >= 400 or not isinstance(payload, dict) or "access_token" not in payload:
            # Never log tokens/secrets.
            err = "token refresh failed"
            if isinstance(payload, dict):
                err = str(payload.get("error_description") or payload.get("error") or err)
            raise GmailApiError(f"Gmail OAuth token refresh failed: {err}", status_code=status)

        token = str(payload["access_token"])
        expires_in = int(payload.get("expires_in") or 3600)
        self._access_token = token
        self._expires_at = now + expires_in
        return token

    def _auth_headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    def _api_request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        retry_on_401: bool = True,
    ) -> dict[str, Any]:
        token = self.get_access_token()
        url = f"{self.api_base}{path}"
        status, payload = _http_json(
            method,
            url,
            headers=self._auth_headers(token),
            json_body=json_body,
        )
        if status == 401 and retry_on_401:
            token = self.get_access_token(force_refresh=True)
            status, payload = _http_json(
                method,
                url,
                headers=self._auth_headers(token),
                json_body=json_body,
            )
        if status >= 400:
            message = "Gmail API request failed"
            if isinstance(payload, dict):
                err = payload.get("error")
                if isinstance(err, dict):
                    message = str(err.get("message") or message)
                elif err:
                    message = str(err)
            raise GmailApiError(message, status_code=status)
        if not isinstance(payload, dict):
            return {"raw": payload}
        return payload

    def get_profile(self) -> dict[str, Any]:
        self.require_configured()
        return self._api_request("GET", "/users/me/profile")

    def send_email(
        self,
        *,
        to: list[str] | str,
        subject: str,
        body: str,
        cc: list[str] | str | None = None,
        bcc: list[str] | str | None = None,
    ) -> dict[str, Any]:
        self.require_configured()
        to_list = normalize_address_list(to)
        cc_list = normalize_address_list(cc)
        bcc_list = normalize_address_list(bcc)
        validate_recipients(to=to_list, cc=cc_list, bcc=bcc_list)

        message = build_mime_message(
            sender=self.user_email,
            to=to_list,
            subject=subject,
            body=body,
            cc=cc_list or None,
            bcc=bcc_list or None,
        )
        raw = encode_raw_mime(message)
        result = self._api_request(
            "POST",
            "/users/me/messages/send",
            json_body={"raw": raw},
        )
        return {
            "success": True,
            "provider": "gmail",
            "message_id": result.get("id"),
            "thread_id": result.get("threadId") or result.get("thread_id"),
            "label_ids": result.get("labelIds") or result.get("label_ids"),
        }


# Process-wide singleton used by API routes and the voice agent.
gmail_email_service = GmailEmailService()
