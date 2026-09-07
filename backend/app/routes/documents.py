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
