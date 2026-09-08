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

            if not chunks:
                raise RuntimeError("Parsing produced no searchable chunks.")

            chunk_texts = []
            for chunk in chunks:
                path_prefix = (
                    f"[Context Path: {' > '.join(chunk.section_path)}]\n"
                    if chunk.section_path
                    else ""
                )
                chunk_texts.append(path_prefix + chunk.content)

            await document_service.update_status(doc_id, "embedding")
            logger.info("[%s] Generating embeddings for %s chunks.", name, len(chunk_texts))

            embeddings = await self._get_embedder().embed_batch_async(chunk_texts)
            if len(embeddings) != len(chunks):
                raise RuntimeError(
                    f"Embedding count mismatch: {len(embeddings)} vectors for {len(chunks)} chunks."
                )
            if any(not vector for vector in embeddings):
                raise RuntimeError("One or more embeddings were empty; refusing to mark document ready.")

            await document_service.replace_chunks(doc_id, chunks, embeddings)
            await document_service.update_status(doc_id, "ready")
            logger.info("[%s] Ingestion complete (%s chunks persisted).", name, len(chunks))
        except Exception as exc:
            logger.exception("[%s] Ingestion failed: %s", name, exc)
            await document_service.update_status(doc_id, "failed", str(exc))
            # Clear embedder cache if API key / client init failed so a later key fix can retry.
            if "GEMINI_API_KEY" in str(exc) or "GOOGLE_API_KEY" in str(exc):
                self._embedder = None


ingestion_worker = IngestionWorker()
