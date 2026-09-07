from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from ..documents import document_service
from .chunker import DocumentChunker
from .embeddings import EmbeddingProvider
from .parsers import parse_document

logger = logging.getLogger("ingestion")


class IngestionWorker:
    def __init__(self) -> None:
        self._running = False
        self._task: asyncio.Task | None = None
        self._chunker = DocumentChunker()
        self._embedder: EmbeddingProvider | None = None

    def _get_embedder(self) -> EmbeddingProvider:
        if self._embedder is None:
            self._embedder = EmbeddingProvider()
        return self._embedder

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Document ingestion worker started.")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Document ingestion worker stopped.")

    async def _loop(self) -> None:
        while self._running:
            try:
                jobs = await document_service.get_unprocessed_documents()
                if jobs:
                    logger.info("Found %s document(s) to process.", len(jobs))
                    for doc in jobs:
                        await self.process_document(doc["id"])
            except Exception as exc:
                logger.exception("Ingestion polling error: %s", exc)
            await asyncio.sleep(1)

    async def process_document(self, doc_id: str) -> None:
        doc = await document_service.get_document(doc_id)
        if not doc:
            return

        name = doc["name"]
        logger.info("[%s] Starting ingestion.", name)
        await document_service.update_status(doc_id, "processing")

        try:
            storage_path = doc["storage_path"]
            if not Path(storage_path).exists():
                raise FileNotFoundError(f"File not found: {storage_path}")

            canonical = parse_document(storage_path, name)
            canonical.document_id = doc_id
            canonical.workspace_id = doc["workspace_id"]

            chunks = self._chunker.chunk(canonical)
            logger.info("[%s] Generated %s chunks.", name, len(chunks))

            chunk_texts = []
            for chunk in chunks:
                path_prefix = (
                    f"[Context Path: {' > '.join(chunk.section_path)}]\n"
                    if chunk.section_path
                    else ""
                )
                chunk_texts.append(path_prefix + chunk.content)

            embeddings: list[list[float]]
            try:
                embeddings = self._get_embedder().embed_batch(chunk_texts)
            except RuntimeError as exc:
                if "GEMINI_API_KEY" in str(exc):
                    logger.warning("[%s] Embedding skipped (no API key); indexing chunks without vectors.", name)
                    embeddings = [[] for _ in chunks]
                else:
                    raise
            await document_service.replace_chunks(doc_id, chunks, embeddings)
            await document_service.update_status(doc_id, "ready")
            logger.info("[%s] Ingestion complete.", name)
        except Exception as exc:
            logger.exception("[%s] Ingestion failed: %s", name, exc)
            await document_service.update_status(doc_id, "failed", str(exc))


ingestion_worker = IngestionWorker()
