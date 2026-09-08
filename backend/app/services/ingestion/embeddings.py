from __future__ import annotations

import asyncio
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor

from google import genai
from google.genai import types

from ...config import settings

logger = logging.getLogger("ingestion.embeddings")

# Bound concurrent embedding requests (matches historical Node batch size of 5).
_EMBED_EXECUTOR = ThreadPoolExecutor(max_workers=5)


class EmbeddingProvider:
    def __init__(self) -> None:
        api_key = settings.gemini_api_key or settings.google_api_key
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is required for document embeddings.")
        self.client = genai.Client(api_key=api_key)
        self.model_name = "gemini-embedding-2"
        self.dimension = 768

    def _normalize(self, values: list[float]) -> list[float]:
        vector = values[: self.dimension]
        norm = math.sqrt(sum(v * v for v in vector))
        if not norm:
            return vector
        return [v / norm for v in vector]

    def _embed_one(self, text: str) -> list[float]:
        response = self.client.models.embed_content(
            model=self.model_name,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=self.dimension),
        )
        if not response.embeddings:
            raise RuntimeError("Embedding API returned no vectors for a single text.")
        return self._normalize(list(response.embeddings[0].values))

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        started = time.perf_counter()
        try:
            response = self.client.models.embed_content(
                model=self.model_name,
                contents=texts,
                config=types.EmbedContentConfig(output_dimensionality=self.dimension),
            )
            if response.embeddings and len(response.embeddings) == len(texts):
                vectors = [self._normalize(list(emb.values)) for emb in response.embeddings]
                if any(not vec for vec in vectors):
                    raise RuntimeError("Embedding API returned an empty vector.")
                logger.info(
                    "Embedded %s texts in %.0fms (batch)",
                    len(texts),
                    (time.perf_counter() - started) * 1000,
                )
                return vectors
        except Exception as exc:
            logger.warning("Batch embedding failed (%s); falling back to bounded concurrency.", exc)

        results: list[list[float]] = []
        batch_size = 5
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            futures = [_EMBED_EXECUTOR.submit(self._embed_one, text) for text in batch]
            for future in futures:
                vector = future.result()
                if not vector:
                    raise RuntimeError("Embedding API returned an empty vector.")
                results.append(vector)

        if len(results) != len(texts):
            raise RuntimeError(
                f"Embedding count mismatch: expected {len(texts)}, got {len(results)}."
            )

        logger.info(
            "Embedded %s texts in %.0fms (concurrent batches of %s)",
            len(texts),
            (time.perf_counter() - started) * 1000,
            batch_size,
        )
        return results

    async def embed_batch_async(self, texts: list[str]) -> list[list[float]]:
        """Run synchronous Gemini embedding calls off the event loop."""
        return await asyncio.to_thread(self.embed_batch, texts)
