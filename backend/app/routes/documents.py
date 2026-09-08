from __future__ import annotations

import os
import shutil
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..config import settings
from ..services.documents import document_service

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("")
async def list_documents(workspaceId: str = "default_workspace"):
    return await document_service.list_documents(workspaceId)


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    workspaceId: str = Form("default_workspace"),
):
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / f"upload_{os.urandom(4).hex()}_{file.filename}"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    size = dest.stat().st_size
    file_type = (file.filename or "txt").split(".")[-1]
    return await document_service.create_document(workspaceId, file.filename or "upload.txt", file_type, str(dest), size)


@router.delete("/{doc_id}")
async def delete_document(doc_id: str):
    deleted = await document_service.delete_document(doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"success": True}


@router.post("/reset-samples")
async def reset_samples(payload: dict):
    workspace_id = payload.get("workspaceId", "default_workspace")
    return await document_service.reset_samples(workspace_id)


@router.post("/search")
async def search_documents(payload: dict):
    """MVP document retrieval endpoint used by tests and the voice agent tool path."""
    query = (payload.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    workspace_id = payload.get("workspaceId") or payload.get("workspace_id") or "default_workspace"
    document_ids = payload.get("documentIds") or payload.get("document_ids")
    top_k = int(payload.get("topK") or payload.get("top_k") or 5)

    try:
        results = await document_service.search_documents(
            workspace_id,
            query,
            document_ids,
            top_k,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {"results": results, "count": len(results)}
