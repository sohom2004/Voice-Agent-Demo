from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

from sql_mcp.agent_prompt import build_system_prompt
from sql_mcp.ticket_workflow import TICKET_TOOL_DEFINITIONS

from ..config import settings
from .documents import document_service
from .sql_mcp import sql_mcp_service

SEARCH_DOCUMENTS = "search_documents"
TICKET_TOOL_NAMES = {t["name"] for t in TICKET_TOOL_DEFINITIONS}

def _audio_to_base64(data: Any) -> str | None:
    if data is None:
        return None
    if isinstance(data, str):
        return data
    if isinstance(data, memoryview):
        data = data.tobytes()
    if isinstance(data, bytearray):
        data = bytes(data)
    if isinstance(data, bytes):
        # Already ASCII base64 from some SDK paths; leave those alone.
        try:
            data.decode("ascii")
            if all(c.isalnum() or c in "+/=\n\r" for c in data.decode("ascii")):
                return data.decode("ascii").strip()
        except UnicodeDecodeError:
            pass
        return base64.b64encode(data).decode("ascii")
    # Fallback for buffer protocol objects (e.g. protobuf)
    try:
        return base64.b64encode(bytes(data)).decode("ascii")
    except Exception:
        return None


SEARCH_DOCUMENTS_TOOL = {
    "name": SEARCH_DOCUMENTS,
    "description": (
        "Search the user's uploaded documents/files (reports, notes, policies, anything "
        "they've uploaded) for information relevant to their question. Use this ONLY for "
        "questions about uploaded documents — never for questions about live database "
        "records, which have their own dedicated tools."
    ),
    "parameters": {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "What to search for."}},
        "required": ["query"],
    },
}


def _system_prompt(schema_summary: str) -> str:
    return build_system_prompt(schema_summary)


def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")
    return genai.Client(api_key=settings.gemini_api_key)


def _to_gemini_tools(tool_defs: list[dict]) -> list[types.Tool]:
    declarations = []
    for tool in tool_defs:
        declarations.append(
            types.FunctionDeclaration(
                name=tool["name"],
                description=tool["description"],
                parameters=tool["parameters"],
            )
        )
    return [types.Tool(function_declarations=declarations)]


async def _dispatch_tool_call(
    name: str,
    args: dict[str, Any],
    tenant_id: str,
    workspace_id: str,
    document_ids: list[str] | None,
) -> Any:
    if name == SEARCH_DOCUMENTS:
        query = args.get("query", "")
        context = await document_service.retrieve_context(workspace_id, query, document_ids)
        return {"context": context} if context else {"context": "", "message": "No relevant documents found."}
    if name in TICKET_TOOL_NAMES:
        return await sql_mcp_service.call_ticket_tool(tenant_id, name, args)
    return await sql_mcp_service.call_tool(tenant_id, name, args)


async def _handle_tool_loop(
    client: genai.Client,
    contents: list[types.Content],
    tenant_id: str,
    workspace_id: str,
    document_ids: list[str] | None,
    tool_defs: list[dict],
) -> str:
    system_instruction = _system_prompt(sql_mcp_service.get_schema_prompt_summary(tenant_id))
    tools = _to_gemini_tools(tool_defs)
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system_instruction,
            tools=tools,
            temperature=0.7,
        ),
    )

    for _ in range(4):
        function_calls = []
        for candidate in response.candidates or []:
            for part in candidate.content.parts or []:
                if part.function_call:
                    function_calls.append(part.function_call)

        if not function_calls:
            return (response.text or "").strip() or "I could not generate a response."

        tool_responses = []
        for call in function_calls:
            args = dict(call.args or {})
            result = await _dispatch_tool_call(call.name, args, tenant_id, workspace_id, document_ids)
            tool_responses.append(
                types.Part(
                    function_response=types.FunctionResponse(
                        name=call.name,
                        response={"result": result},
                    )
                )
            )

        contents = contents + [response.candidates[0].content] + [
            types.Content(role="user", parts=tool_responses)
        ]
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                tools=tools,
                temperature=0.7,
            ),
        )

    return (response.text or "").strip() or "I completed the operation."


async def generate_chat_response(
    message: str,
    history: list[dict[str, str]],
    tenant_id: str,
    workspace_id: str,
    document_ids: list[str] | None,
    voice_name: str,
    generate_audio: bool,
) -> dict[str, Any]:
    client = _get_client()
    contents: list[types.Content] = []
    for item in history:
        role = "user" if item.get("role") == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part(text=item.get("content", ""))]))
    contents.append(types.Content(role="user", parts=[types.Part(text=message)]))

    tool_defs = (
        sql_mcp_service.get_gemini_tools(tenant_id)
        + [
            {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            }
            for t in TICKET_TOOL_DEFINITIONS
        ]
        + [SEARCH_DOCUMENTS_TOOL]
    )
    text = await _handle_tool_loop(client, contents, tenant_id, workspace_id, document_ids, tool_defs)

    audio_base64 = None
    if generate_audio and text:
        valid_voices = ["Kore", "Aoede", "Zephyr", "Puck", "Fenrir", "Charon"]
        selected_voice = voice_name if voice_name in valid_voices else "Kore"
        clean = text.replace("*", "").replace("#", "").replace("`", "")[:1500]
        try:
            tts = client.models.generate_content(
                model="gemini-2.5-flash-preview-tts",
                contents=[types.Content(role="user", parts=[types.Part(text=clean)])],
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=selected_voice)
                        )
                    ),
                ),
            )
            for candidate in tts.candidates or []:
                for part in candidate.content.parts or []:
                    if part.inline_data and part.inline_data.data:
                        audio_base64 = _audio_to_base64(part.inline_data.data)
        except Exception:
            pass

    return {
        "text": text,
        "audioBase64": _audio_to_base64(audio_base64) if audio_base64 is not None else None,
        "suggestedQuestions": [
            "Why was claim CLM10002 denied?",
            "What is the status of ticket TKT10001?",
            "What is the policy for appealing a denied claim?",
        ],
        "groundedDocs": [],
    }


async def generate_tts(text: str, voice_name: str) -> str | None:
    client = _get_client()
    valid_voices = ["Kore", "Aoede", "Zephyr", "Puck", "Fenrir", "Charon"]
    selected_voice = voice_name if voice_name in valid_voices else "Kore"
    clean = text.replace("*", "").replace("#", "").replace("`", "")[:1500]
    response = client.models.generate_content(
        model="gemini-2.5-flash-preview-tts",
        contents=[types.Content(role="user", parts=[types.Part(text=clean)])],
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=selected_voice)
                )
            ),
        ),
    )
    for candidate in response.candidates or []:
        for part in candidate.content.parts or []:
            if part.inline_data and part.inline_data.data:
                return _audio_to_base64(part.inline_data.data)
    return None
