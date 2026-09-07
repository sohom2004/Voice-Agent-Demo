from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..services.chat import generate_chat_response, generate_tts
from ..services.documents import document_service

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

    doc_context = await document_service.retrieve_context(workspace_id, message, document_ids)
    return await generate_chat_response(
        message=message,
        history=history,
        tenant_id=tenant_id,
        doc_context=doc_context,
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
