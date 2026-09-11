"""GmailEmailService unit tests — mocked HTTP, never sends real email."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import patch

import pytest

from app.services.email import (
    GmailApiError,
    GmailConfigError,
    GmailEmailService,
    build_mime_message,
    encode_raw_mime,
    is_valid_email,
    normalize_address_list,
    sanitize_subject,
    validate_recipients,
)


def _svc(**overrides: Any) -> GmailEmailService:
    defaults = {
        "client_id": "cid",
        "client_secret": "csecret",
        "refresh_token": "rtoken",
        "user_email": "natasha@example.com",
    }
    defaults.update(overrides)
    return GmailEmailService(**defaults)


def test_missing_config_is_configured_false():
    svc = GmailEmailService(
        client_id="",
        client_secret="x",
        refresh_token="y",
        user_email="a@b.com",
    )
    assert svc.is_configured() is False
    status = svc.gmail_status()
    assert status["configured"] is False
    assert "GMAIL_CLIENT_ID" in (status.get("error") or "")
    # Never leak secrets
    blob = json.dumps(status)
    assert "csecret" not in blob
    assert "rtoken" not in blob


def test_gmail_status_safe_when_configured():
    svc = _svc()
    status = svc.gmail_status()
    assert status == {
        "configured": True,
        "authenticated_email": "natasha@example.com",
    }


def test_require_configured_raises():
    svc = GmailEmailService(client_id="", client_secret="", refresh_token="", user_email="")
    with pytest.raises(GmailConfigError):
        svc.require_configured()


def test_invalid_email_helpers():
    assert is_valid_email("good@example.com") is True
    assert is_valid_email("bad") is False
    assert is_valid_email("") is False
    assert sanitize_subject("Hi\r\nThere") == "Hi  There"
    assert normalize_address_list("a@x.com, b@y.com") == ["a@x.com", "b@y.com"]
    assert normalize_address_list(["a@x.com", " b@y.com "]) == ["a@x.com", "b@y.com"]
    with pytest.raises(ValueError, match="to"):
        validate_recipients(to=[])
    with pytest.raises(ValueError, match="Invalid"):
        validate_recipients(to=["not-an-email"])


def test_mime_to_cc_bcc_and_encode():
    msg = build_mime_message(
        sender="from@example.com",
        to=["a@example.com", "b@example.com"],
        subject="Subj",
        body="Hello body",
        cc=["c@example.com"],
        bcc=["d@example.com"],
    )
    assert msg["From"] == "from@example.com"
    assert msg["To"] == "a@example.com, b@example.com"
    assert msg["Cc"] == "c@example.com"
    assert msg["Bcc"] == "d@example.com"
    assert msg["Subject"] == "Subj"
    raw = encode_raw_mime(msg)
    assert isinstance(raw, str)
    assert "=" not in raw  # base64url without padding
    assert len(raw) > 20


def test_token_refresh_and_cache():
    svc = _svc()
    calls: list[tuple[str, str]] = []

    def fake_http(method, url, **kwargs):
        calls.append((method, url))
        if "oauth2.googleapis.com/token" in url:
            return 200, {"access_token": "tok-1", "expires_in": 3600}
        raise AssertionError(f"unexpected url {url}")

    with patch("app.services.email._http_json", side_effect=fake_http):
        t1 = svc.get_access_token()
        t2 = svc.get_access_token()  # cached
        assert t1 == t2 == "tok-1"
        assert len(calls) == 1
        t3 = svc.get_access_token(force_refresh=True)
        assert t3 == "tok-1"
        assert len(calls) == 2


def test_token_refresh_failure():
    svc = _svc()

    def fake_http(method, url, **kwargs):
        return 400, {"error": "invalid_grant", "error_description": "bad refresh"}

    with patch("app.services.email._http_json", side_effect=fake_http):
        with pytest.raises(GmailApiError, match="token refresh"):
            svc.get_access_token(force_refresh=True)


def test_send_email_success():
    svc = _svc()

    def fake_http(method, url, **kwargs):
        if "oauth2.googleapis.com/token" in url:
            return 200, {"access_token": "tok", "expires_in": 3600}
        if url.endswith("/users/me/messages/send"):
            body = kwargs.get("json_body") or {}
            assert "raw" in body
            return 200, {"id": "msg-123", "threadId": "thr-9", "labelIds": ["SENT"]}
        raise AssertionError(url)

    with patch("app.services.email._http_json", side_effect=fake_http):
        result = svc.send_email(
            to="alice@example.com",
            subject="Hello",
            body="Hi Alice",
            cc="cc@example.com",
            bcc=["bcc@example.com"],
        )
    assert result["success"] is True
    assert result["provider"] == "gmail"
    assert result["message_id"] == "msg-123"
    assert result["thread_id"] == "thr-9"


def test_send_email_401_refreshes_once_and_retries():
    svc = _svc()
    send_calls = {"n": 0}
    tokens: list[str] = []

    def fake_http(method, url, *, headers=None, **kwargs):
        if "oauth2.googleapis.com/token" in url:
            token = f"tok-{len(tokens) + 1}"
            tokens.append(token)
            return 200, {"access_token": token, "expires_in": 3600}
        if url.endswith("/users/me/messages/send"):
            send_calls["n"] += 1
            auth = (headers or {}).get("Authorization", "")
            if send_calls["n"] == 1:
                assert auth == "Bearer tok-1"
                return 401, {"error": {"message": "Unauthorized"}}
            assert auth == "Bearer tok-2"
            return 200, {"id": "msg-ok", "threadId": "thr-ok"}
        raise AssertionError(url)

    with patch("app.services.email._http_json", side_effect=fake_http):
        result = svc.send_email(to="a@example.com", subject="S", body="B")
    assert result["message_id"] == "msg-ok"
    assert send_calls["n"] == 2
    assert tokens == ["tok-1", "tok-2"]


def test_send_email_api_failure():
    svc = _svc()

    def fake_http(method, url, **kwargs):
        if "oauth2.googleapis.com/token" in url:
            return 200, {"access_token": "tok", "expires_in": 3600}
        return 500, {"error": {"message": "backend boom"}}

    with patch("app.services.email._http_json", side_effect=fake_http):
        with pytest.raises(GmailApiError, match="backend boom") as excinfo:
            svc.send_email(to="a@example.com", subject="S", body="B")
        assert excinfo.value.status_code == 500


def test_send_email_invalid_recipient():
    svc = _svc()
    with pytest.raises(ValueError, match="Invalid"):
        svc.send_email(to="not-valid", subject="S", body="B")
