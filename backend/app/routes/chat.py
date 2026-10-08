from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..services.chat import generate_chat_response, generate_tts

router = APIRouter(prefix="/api", tags=["chat"])


import logging

logger = logging.getLogger("app.routes.chat")


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

    try:
        return await generate_chat_response(
            message=message,
            history=history,
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            document_ids=document_ids,
            voice_name=voice_name,
            generate_audio=generate_audio,
        )
    except Exception as exc:
        logger.exception("Failed to generate chat response: %s", exc)
        return {
            "text": "I'm temporarily experiencing high demand from the AI provider. Please try asking again in a few moments.",
            "audioBase64": None,
            "suggestedQuestions": [
                "Why was claim CLM10002 denied?",
                "What is the status of ticket TKT10001?",
                "What is the policy for appealing a denied claim?",
            ],
            "groundedDocs": [],
            "error": str(exc),
        }


@router.post("/tts")
async def tts(payload: dict):
    text = payload.get("text", "")
    voice_name = payload.get("voiceName", "Kore")
    if not text:
        raise HTTPException(status_code=400, detail="Text is required.")
    audio = await generate_tts(text, voice_name)
    return {"audioBase64": audio}
