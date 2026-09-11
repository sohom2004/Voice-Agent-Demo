"""Email confirmation state machine tests."""

from __future__ import annotations

import pytest

from app.services.email_flow import (
    EmailFlowController,
    EmailFlowState,
    is_send_authorization,
    is_send_denial,
)


def test_prepare_moves_to_drafted_and_public_dict():
    flow = EmailFlowController(room_id="room-1")
    draft = flow.prepare(
        to="alice@example.com",
        subject="Hello",
        body="Body text",
        cc="bob@example.com",
    )
    assert draft.state == EmailFlowState.DRAFTED
    pub = draft.to_public_dict()
    assert pub["state"] == "DRAFTED"
    assert pub["to"] == ["alice@example.com"]
    assert pub["cc"] == ["bob@example.com"]
    assert pub["subject"] == "Hello"
    assert "room_id" in pub


def test_full_happy_path_to_authorized_then_sent():
    flow = EmailFlowController()
    flow.prepare(to="a@example.com", subject="S", body="B")
    flow.present()
    assert flow.draft.state == EmailFlowState.PRESENTED
    flow.confirm_details()
    assert flow.draft.state == EmailFlowState.DETAILS_CONFIRMED
    flow.await_send_authorization()
    assert flow.draft.state == EmailFlowState.AWAITING_SEND_AUTHORIZATION
    flow.authorize("Yes, send it")
    assert flow.draft.state == EmailFlowState.AUTHORIZED
    assert flow.can_send() is True
    flow.mark_sent(message_id="m1", thread_id="t1")
    assert flow.draft.state == EmailFlowState.SENT
    assert flow.draft.provider_message_id == "m1"
    assert flow.can_send() is False


def test_draft_mutation_invalidates_authorization():
    flow = EmailFlowController()
    flow.prepare(to="a@example.com", subject="S", body="B")
    flow.present()
    flow.confirm_details()
    flow.await_send_authorization()
    flow.authorize("Yes, send it")
    assert flow.can_send() is True

    flow.update_draft(subject="Changed subject")
    assert flow.draft.state == EmailFlowState.DRAFTED
    assert flow.can_send() is False
    assert flow.draft.provider_message_id is None

    with pytest.raises(ValueError, match="not authorized"):
        flow.mark_sent(message_id="x")


def test_prepare_also_resets_authorization():
    flow = EmailFlowController()
    flow.prepare(to="a@example.com", subject="S", body="B")
    flow.await_send_authorization()
    flow.authorize("send it")
    assert flow.can_send() is True
    flow.prepare(to="b@example.com", subject="New", body="N")
    assert flow.draft.state == EmailFlowState.DRAFTED
    assert flow.can_send() is False


@pytest.mark.parametrize(
    "phrase",
    [
        "Yes, send it",
        "yes",
        "Send it",
        "Go ahead",
        "Please send it",
        "I authorize sending",
    ],
)
def test_yes_send_authorizes(phrase: str):
    assert is_send_authorization(phrase) is True
    assert is_send_denial(phrase) is False


@pytest.mark.parametrize(
    "phrase",
    [
        "No",
        "No, don't send",
        "Don't send",
        "Wait",
        "Not yet",
        "Cancel",
        "Hold on",
        "Never mind",
    ],
)
def test_no_dont_send_never_authorizes(phrase: str):
    assert is_send_denial(phrase) is True
    assert is_send_authorization(phrase) is False


def test_authorize_rejects_denial_and_keeps_unsent():
    flow = EmailFlowController()
    flow.prepare(to="a@example.com", subject="S", body="B")
    flow.await_send_authorization()
    with pytest.raises(PermissionError):
        flow.authorize("No, don't send")
    assert flow.draft.state == EmailFlowState.DETAILS_CONFIRMED
    assert flow.can_send() is False


def test_authorize_rejects_ambiguous():
    flow = EmailFlowController()
    flow.prepare(to="a@example.com", subject="S", body="B")
    flow.await_send_authorization()
    with pytest.raises(PermissionError):
        flow.authorize("maybe later if you want")
    assert flow.can_send() is False


def test_clear_resets_to_idle():
    flow = EmailFlowController(room_id="r")
    flow.prepare(to="a@example.com", subject="S", body="B")
    flow.clear()
    assert flow.draft.state == EmailFlowState.IDLE
    assert flow.draft.room_id == "r"
    assert flow.draft.to == []
