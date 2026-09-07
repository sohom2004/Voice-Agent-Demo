from __future__ import annotations

import math

from google import genai
from google.genai import types

from ...config import settings


class EmbeddingProvider:
    def __init__(self) -> None:
        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is required for document embeddings.")
        self.client = genai.Client(api_key=settings.gemini_api_key)
        self.model_name = "gemini-embedding-2"
        self.dimension = 768

    def _normalize(self, values: list[float]) -> list[float]:
        vector = values[: self.dimension]
        norm = math.sqrt(sum(v * v for v in vector))
        if not norm:
            return vector
        return [v / norm for v in vector]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        response = self.client.models.embed_content(
            model=self.model_name,
            contents=texts,
            config=types.EmbedContentConfig(output_dimensionality=self.dimension),
        )
        if response.embeddings and len(response.embeddings) == len(texts):
            return [self._normalize(list(emb.values)) for emb in response.embeddings]

        results: list[list[float]] = []
        batch_size = 5
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            batch_response = self.client.models.embed_content(
                model=self.model_name,
                contents=batch,
                config=types.EmbedContentConfig(output_dimensionality=self.dimension),
            )
            if not batch_response.embeddings:
                raise RuntimeError("Embedding API returned no vectors.")
            results.extend(self._normalize(list(emb.values)) for emb in batch_response.embeddings)
        return results
