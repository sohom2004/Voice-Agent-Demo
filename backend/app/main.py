from __future__ import annotations

import asyncio
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes.chat import router as chat_router
from .routes.documents import router as documents_router
from .routes.livekit import router as livekit_router
from .routes.sql_mcp import router as sql_mcp_router
from .services.documents import document_service


ingestion_process: subprocess.Popen | None = None


def _start_ingestion_worker() -> subprocess.Popen | None:
    root = Path(__file__).resolve().parents[2]
    package_json = root / "package.json"
    if not package_json.exists():
        return None
    return subprocess.Popen(
        ["npm", "run", "ingestion-worker"],
        cwd=str(root),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    global ingestion_process
    await document_service.connect()
    ingestion_process = _start_ingestion_worker()
    yield
    if ingestion_process and ingestion_process.poll() is None:
        ingestion_process.terminate()
        try:
            ingestion_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            ingestion_process.kill()


app = FastAPI(title="Natasha API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents_router)
app.include_router(chat_router)
app.include_router(livekit_router)
app.include_router(sql_mcp_router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "backend": "fastapi", "voice": "livekit", "database": "sql-mcp"}
