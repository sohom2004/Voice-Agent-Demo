from __future__ import annotations

import logging
import os
import subprocess
import sys
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routes.chat import router as chat_router
from .routes.documents import router as documents_router
from .routes.email import router as email_router
from .routes.livekit import router as livekit_router
from .routes.sql_mcp import router as sql_mcp_router
from .services.documents import document_service
from .services.ingestion.worker import ingestion_worker

logger = logging.getLogger("app.main")

_REPO_ROOT = Path(__file__).resolve().parents[2]
_voice_agent_process: subprocess.Popen | None = None


def _voice_agent_enabled() -> bool:
    """Run the LiveKit voice agent as a subprocess of this web service.

    On Render's free tier a separate Background Worker isn't available, so
    the agent is launched inside the same (free) web service instance
    instead of a dedicated worker service. Local dev keeps starting it
    separately via `npm run dev:voice-agent`, so this only auto-starts when
    explicitly enabled (Render sets RUN_VOICE_AGENT_INPROCESS=true).
    """
    return os.getenv("RUN_VOICE_AGENT_INPROCESS", "").lower() in ("1", "true", "yes")


def _start_voice_agent() -> None:
    global _voice_agent_process
    agent_path = _REPO_ROOT / "voice-agent" / "agent.py"
    if not agent_path.is_file():
        logger.warning("voice-agent/agent.py not found; skipping in-process voice agent")
        return
    try:
        _voice_agent_process = subprocess.Popen(
            [sys.executable, str(agent_path), "start"],
            cwd=str(agent_path.parent),
        )
        logger.info("Started in-process voice agent worker (pid=%s)", _voice_agent_process.pid)
    except Exception:
        logger.exception("Failed to start in-process voice agent worker")


def _stop_voice_agent() -> None:
    global _voice_agent_process
    if _voice_agent_process is not None and _voice_agent_process.poll() is None:
        _voice_agent_process.terminate()
        try:
            _voice_agent_process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            _voice_agent_process.kill()
    _voice_agent_process = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await document_service.connect()
    await ingestion_worker.start()
    if _voice_agent_enabled():
        _start_voice_agent()
    yield
    _stop_voice_agent()
    await ingestion_worker.stop()


app = FastAPI(title="Natasha Medical Billing BPO API", version="4.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents_router)
app.include_router(chat_router)
app.include_router(email_router)
app.include_router(livekit_router)
app.include_router(sql_mcp_router)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "backend": "fastapi",
        "voice": "livekit",
        "database": "postgresql",
        "ingestion": "python-worker",
    }


_DIST = Path(__file__).resolve().parents[2] / "dist"
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="frontend")
