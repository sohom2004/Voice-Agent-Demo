from __future__ import annotations

import uuid

from livekit import api

from ..config import settings


def create_livekit_token(room_name: str | None = None, identity: str | None = None) -> dict[str, str]:
    if not settings.livekit_url or not settings.livekit_api_key or not settings.livekit_api_secret:
        raise RuntimeError(
            "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET."
        )

    room = room_name or f"natasha-{uuid.uuid4().hex[:8]}"
    user_identity = identity or f"user-{uuid.uuid4().hex[:8]}"

    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(user_identity)
        .with_name("Natasha User")
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
            )
        )
        .to_jwt()
    )

    return {
        "token": token,
        "roomName": room,
        "identity": user_identity,
        "url": settings.livekit_url,
    }
