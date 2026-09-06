from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

from ..config import settings
from .sql_mcp import sql_mcp_service


SYSTEM_PROMPT = """You are Natasha, an intelligent, warm, polyglot voice companion.
You help users with uploaded documents and live database information.
Use sql-mcp tools to query or update the database when needed.
Speak naturally for voice — avoid markdown, bullet points, and raw JSON.
Never expose internal SQL or schema jargon to non-technical users.
"""


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


async def _handle_tool_loop(
    client: genai.Client,
    contents: list[types.Content],
    tenant_id: str,
    tool_defs: list[dict],
    doc_context: str,
) -> str:
    system_instruction = SYSTEM_PROMPT
    if doc_context:
        system_instruction += f"\n\n--- DOCUMENT CONTEXT ---\n{doc_context}\n--- END ---\n"

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
            result = await sql_mcp_service.call_tool(tenant_id, call.name, args)
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

    return (response.text or "").strip() or "I completed the database operation."


async def generate_chat_response(
    message: str,
    history: list[dict[str, str]],
    tenant_id: str,
    doc_context: str,
    voice_name: str,
    generate_audio: bool,
) -> dict[str, Any]:
    client = _get_client()
    contents: list[types.Content] = []
    for item in history:
        role = "user" if item.get("role") == "user" else "model"
        contents.append(types.Content(role=role, parts=[types.Part(text=item.get("content", ""))]))
    contents.append(types.Content(role="user", parts=[types.Part(text=message)]))

    tool_defs = sql_mcp_service.get_gemini_tools(tenant_id)
    text = await _handle_tool_loop(client, contents, tenant_id, tool_defs, doc_context)

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
                        audio_base64 = part.inline_data.data
        except Exception:
            pass

    return {
        "text": text,
        "audioBase64": audio_base64,
        "suggestedQuestions": [
            "What tables are in the database?",
            "Show me recent patient records.",
            "Can you summarize the uploaded documents?",
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
                return part.inline_data.data
    return None
