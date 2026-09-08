from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..services.chat import generate_chat_response, generate_tts

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat")
async def chat(payload: dict):
    message = payload.get("message", "")
    if not message:
        raise HTTPException(status_code=400, detail="Message is required.")

    workspace_id = payload.get("workspaceId", "default_workspace")
    tenant_id = payload.get("tenantId", "default_tenant")
    history = payload.get("history", [])
    document_ids = payload.get("documentIds", [])
    voice_name = payload.get("selectedVoice", "Kore")
    generate_audio = payload.get("generateAudio", True)

    # Document context is no longer fetched unconditionally on every message —
    # the model calls the search_documents tool itself only when the question
    # is actually about uploaded documents, so a pure database question no
    # longer pays for an embedding call + full chunk scan it doesn't need.
    return await generate_chat_response(
        message=message,
        history=history,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        document_ids=document_ids,
        voice_name=voice_name,
        generate_audio=generate_audio,
    )


@router.post("/tts")
async def tts(payload: dict):
    text = payload.get("text", "")
    voice_name = payload.get("voiceName", "Kore")
    if not text:
        raise HTTPException(status_code=400, detail="Text is required.")
    audio = await generate_tts(text, voice_name)
    return {"audioBase64": audio}
