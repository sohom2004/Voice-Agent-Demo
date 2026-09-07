from __future__ import annotations

import re
from dataclasses import dataclass

from .parsers import CanonicalDocument, DocumentChunk, DocumentSection


@dataclass
class ChunkerConfig:
    target_size: int = 1000
    overlap: int = 150


class DocumentChunker:
    def __init__(self, config: ChunkerConfig | None = None):
        self.config = config or ChunkerConfig()

    def chunk(self, doc: CanonicalDocument) -> list[DocumentChunk]:
        chunks: list[DocumentChunk] = []
        chunk_index = 0

        def enrich_content(path: list[str], text: str) -> str:
            path_header = f" > {' > '.join(path)}" if path else ""
            return f"[Source: {doc.name}{path_header}]\n\n{text}"

        def walk(sections: list[DocumentSection], current_path: list[str], metadata: dict) -> None:
            nonlocal chunk_index
            buffer = ""
            buffer_metadata = dict(metadata)

            def flush_buffer() -> None:
                nonlocal buffer, chunk_index
                if not buffer.strip():
                    return
                chunks.append(
                    DocumentChunk(
                        workspace_id=doc.workspace_id,
                        document_id=doc.document_id,
                        document_name=doc.name,
                        section_path=list(current_path),
                        chunk_index=chunk_index,
                        content=enrich_content(current_path, buffer.strip()),
                        metadata={"sourceType": doc.file_type, **buffer_metadata},
                    )
                )
                chunk_index += 1
                buffer = ""

            for section in sections:
                section_path = [*current_path, section.title] if section.title else list(current_path)
                if section.content:
                    section_header = f"### {section.title}\n" if section.title else ""
                    content_to_append = section_header + section.content
                    if len(buffer) + len(content_to_append) > self.config.target_size and buffer:
                        flush_buffer()
                    if section.source:
                        buffer_metadata = {**buffer_metadata, **section.source}
                    buffer += ("\n\n" if buffer else "") + content_to_append

                if section.children:
                    if len(buffer) > self.config.target_size * 0.7:
                        flush_buffer()
                    walk(section.children, section_path, dict(buffer_metadata))
                elif section.content and len(section.content) > self.config.target_size:
                    flush_buffer()
                    sentences = re.findall(r"[^.!?]+[.!?]+(?:\s|$)", section.content) or [section.content]
                    sub_buffer = ""
                    for sentence in sentences:
                        if len(sub_buffer) + len(sentence) > self.config.target_size and sub_buffer:
                            chunks.append(
                                DocumentChunk(
                                    workspace_id=doc.workspace_id,
                                    document_id=doc.document_id,
                                    document_name=doc.name,
                                    section_path=list(section_path),
                                    chunk_index=chunk_index,
                                    content=enrich_content(section_path, sub_buffer.strip()),
                                    metadata={"sourceType": doc.file_type, **section.source},
                                )
                            )
                            chunk_index += 1
                            sub_buffer = sub_buffer[-self.config.overlap :]
                        sub_buffer += sentence
                    if sub_buffer.strip():
                        buffer = sub_buffer
                        buffer_metadata = {**buffer_metadata, **section.source}

            flush_buffer()

        walk(doc.sections, [], {})
        return chunks
