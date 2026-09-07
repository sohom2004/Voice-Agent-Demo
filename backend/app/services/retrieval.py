from __future__ import annotations

import asyncio

from ..config import settings
from ..services.documents import document_service
from ..services.sql_mcp import sql_mcp_service
from .context_plan import ContextPlan


class RawRetrievalResults:
    def __init__(self):
        self.doc_context_string = ""
        self.db_schema_context = ""
        self.latencies = {"documentsMs": 0, "databaseMs": 0, "totalMs": 0}


class RetrievalExecutor:
    async def execute(self, plan: ContextPlan, active_document_ids: list[str] | None = None) -> RawRetrievalResults:
        total_start = asyncio.get_event_loop().time()
        results = RawRetrievalResults()

        if plan.sources.documents:
            doc_start = asyncio.get_event_loop().time()
            query = plan.retrieval.document_query or plan.resolved_message
            results.doc_context_string = await document_service.retrieve_context(
                plan.workspace_id,
                query,
                active_document_ids,
                plan.retrieval.max_documents or 5,
            )
            results.latencies["documentsMs"] = int((asyncio.get_event_loop().time() - doc_start) * 1000)

        if plan.sources.database:
            db_start = asyncio.get_event_loop().time()
            ctx = sql_mcp_service.get_column_context("default_tenant")
            tables = ctx.get("tables", [])
            lines = ["<database_schema>"]
            for table in tables:
                cols = ", ".join(f"{c['name']}:{c['dataType']}" for c in table.get("columns", []))
                lines.append(f"  <table name='{table['name']}'>{cols}</table>")
            lines.append("</database_schema>")
            results.db_schema_context = "\n".join(lines)
            results.latencies["databaseMs"] = int((asyncio.get_event_loop().time() - db_start) * 1000)

        results.latencies["totalMs"] = int((asyncio.get_event_loop().time() - total_start) * 1000)
        return results


retrieval_executor = RetrievalExecutor()
