from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..services.livekit_tokens import create_livekit_token

router = APIRouter(prefix="/api/livekit", tags=["livekit"])


@router.post("/token")
async def livekit_token(payload: dict | None = None):
    payload = payload or {}
    try:
        return create_livekit_token(payload.get("roomName"), payload.get("identity"))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
