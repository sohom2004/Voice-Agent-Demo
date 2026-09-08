from __future__ import annotations

import json
import uuid

from livekit import api

from ..config import settings


def create_livekit_token(
    room_name: str | None = None,
    identity: str | None = None,
    *,
    workspace_id: str = "default_workspace",
    document_ids: list[str] | None = None,
    voice_name: str | None = None,
) -> dict[str, str]:
    if not settings.livekit_url or not settings.livekit_api_key or not settings.livekit_api_secret:
        raise RuntimeError(
            "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET."
        )

    room = room_name or f"natasha-{uuid.uuid4().hex[:8]}"
    user_identity = identity or f"user-{uuid.uuid4().hex[:8]}"
    metadata = {
        "workspace_id": workspace_id or "default_workspace",
        "document_ids": document_ids or [],
    }
    if voice_name:
        metadata["voice_name"] = voice_name

    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(user_identity)
        .with_name("Natasha User")
        .with_metadata(json.dumps(metadata))
        .with_attributes(
            {
                "workspace_id": metadata["workspace_id"],
                "document_ids": json.dumps(metadata["document_ids"]),
            }
        )
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
        .to_jwt()
    )

    return {
        "token": token,
        "roomName": room,
        "identity": user_identity,
        "url": settings.livekit_url,
        "metadata": metadata,
    }
