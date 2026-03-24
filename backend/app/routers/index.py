from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth import AuthContext, require_api_key
from app.db import get_db
from app.indexing import (
    DeleteIndexResponse,
    IndexListResponse,
    IndexRequest,
    IndexStatusResponse,
    SubmitIndexResponse,
    UnifiedIndexService,
)
from app.search import ErrorResponse

router = APIRouter(
    prefix="/v1",
    tags=["index"],
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)


@router.post("/index", response_model=SubmitIndexResponse, status_code=202)
async def submit_index(
    payload: IndexRequest,
    auth: AuthContext = Depends(require_api_key),
    db: Any = Depends(get_db),
) -> SubmitIndexResponse:
    service = UnifiedIndexService(db)
    return await service.submit(payload, auth=auth)


@router.get("/index", response_model=IndexListResponse)
async def list_indexed_videos(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    auth: AuthContext = Depends(require_api_key),
    db: Any = Depends(get_db),
) -> IndexListResponse:
    service = UnifiedIndexService(db)
    return await service.list_videos(
        auth=auth,
        page=page,
        per_page=per_page,
    )


@router.get("/index/{video_id}", response_model=IndexStatusResponse)
async def get_index_status(
    video_id: str,
    auth: AuthContext = Depends(require_api_key),
    db: Any = Depends(get_db),
) -> IndexStatusResponse:
    service = UnifiedIndexService(db)
    return await service.get_status(video_id, auth=auth)


@router.delete("/index/{video_id}", response_model=DeleteIndexResponse)
async def delete_indexed_video(
    video_id: str,
    auth: AuthContext = Depends(require_api_key),
    db: Any = Depends(get_db),
) -> DeleteIndexResponse:
    service = UnifiedIndexService(db)
    return await service.delete(video_id, auth=auth)
