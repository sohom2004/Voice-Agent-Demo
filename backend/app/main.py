from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes.chat import router as chat_router
from .routes.documents import router as documents_router
from .routes.livekit import router as livekit_router
from .routes.sql_mcp import router as sql_mcp_router
from .services.documents import document_service
from .services.ingestion.worker import ingestion_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    await document_service.connect()
    await ingestion_worker.start()
    yield
    await ingestion_worker.stop()


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
    return {
        "status": "ok",
        "backend": "fastapi",
        "voice": "livekit",
        "database": "sql-mcp",
        "ingestion": "python-worker",
    }
