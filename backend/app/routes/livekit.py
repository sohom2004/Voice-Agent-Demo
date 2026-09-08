from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..services.livekit_tokens import create_livekit_token

router = APIRouter(prefix="/api/livekit", tags=["livekit"])


@router.post("/token")
async def livekit_token(payload: dict | None = None):
    payload = payload or {}
    document_ids = payload.get("documentIds") or payload.get("document_ids") or []
    if isinstance(document_ids, str):
        document_ids = [document_ids]
    if not isinstance(document_ids, list):
        raise HTTPException(status_code=400, detail="documentIds must be a list of strings")

    workspace_id = (
        payload.get("workspaceId")
        or payload.get("workspace_id")
        or "default_workspace"
    )
    voice_name = payload.get("voiceName") or payload.get("voice_name")

    try:
        return create_livekit_token(
            payload.get("roomName") or payload.get("room_name"),
            payload.get("identity"),
            workspace_id=workspace_id,
            document_ids=[str(doc_id) for doc_id in document_ids],
            voice_name=voice_name,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
