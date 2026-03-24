"""Private admin console API endpoints."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.admin import (
    AdminDeleteVideoResponse,
    AdminIndexedVideosResponse,
    AdminSource,
    AdminSourcesResponse,
    AdminSummaryResponse,
    AdminTargetsResponse,
    AdminTargetsUpsertRequest,
    AdminWorkerLiveResponse,
    CreateSourceRequest,
    UpdateSourceRequest,
    create_source,
    delete_source,
    delete_indexed_video_data,
    delete_target,
    fetch_admin_summary,
    fetch_content_summary,
    fetch_ingestion_summary,
    fetch_indexed_videos,
    fetch_requests_summary,
    fetch_sources,
    fetch_targets_summary,
    fetch_users_summary,
    fetch_worker_live,
    kill_job,
    require_admin_access,
    retry_job,
    update_source,
    upsert_targets,
)
from app.admin.models import (
    AdminContentSummaryResponse,
    AdminIngestionSummaryResponse,
    AdminRangeKey,
    AdminRequestsSummaryResponse,
    AdminUsersSummaryResponse,
)
from app.auth import SessionContext, require_session
from app.db import get_db

router = APIRouter(prefix="/admin", tags=["admin"])


def _resolve_range(range_key: AdminRangeKey | None) -> AdminRangeKey:
    return range_key or "7d"


@router.get("/summary", response_model=AdminSummaryResponse)
async def get_admin_summary(
    range_key: AdminRangeKey | None = Query(default="7d", alias="range"),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminSummaryResponse:
    await require_admin_access(session, db)
    return await fetch_admin_summary(db, range_key=_resolve_range(range_key))


@router.get("/users/summary", response_model=AdminUsersSummaryResponse)
async def get_admin_users_summary(
    range_key: AdminRangeKey | None = Query(default="7d", alias="range"),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminUsersSummaryResponse:
    await require_admin_access(session, db)
    return await fetch_users_summary(db, range_key=_resolve_range(range_key))


@router.get("/requests/summary", response_model=AdminRequestsSummaryResponse)
async def get_admin_requests_summary(
    range_key: AdminRangeKey | None = Query(default="7d", alias="range"),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminRequestsSummaryResponse:
    await require_admin_access(session, db)
    return await fetch_requests_summary(db, range_key=_resolve_range(range_key))


@router.get("/content/summary", response_model=AdminContentSummaryResponse)
async def get_admin_content_summary(
    range_key: AdminRangeKey | None = Query(default="7d", alias="range"),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminContentSummaryResponse:
    await require_admin_access(session, db)
    return await fetch_content_summary(db, range_key=_resolve_range(range_key))


@router.get("/ingestion/summary", response_model=AdminIngestionSummaryResponse)
async def get_admin_ingestion_summary(
    range_key: AdminRangeKey | None = Query(default="7d", alias="range"),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminIngestionSummaryResponse:
    await require_admin_access(session, db)
    return await fetch_ingestion_summary(db, range_key=_resolve_range(range_key))


@router.get("/targets", response_model=AdminTargetsResponse)
async def get_admin_targets(
    range_key: AdminRangeKey | None = Query(default="7d", alias="range"),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminTargetsResponse:
    await require_admin_access(session, db)
    return await fetch_targets_summary(db, range_key=_resolve_range(range_key))


@router.put("/targets", response_model=AdminTargetsResponse)
async def put_admin_targets(
    payload: AdminTargetsUpsertRequest,
    range_key: AdminRangeKey | None = Query(default="7d", alias="range"),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminTargetsResponse:
    await require_admin_access(session, db)
    try:
        await upsert_targets(db, targets=payload.targets)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return await fetch_targets_summary(db, range_key=_resolve_range(range_key))


@router.delete("/targets/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_admin_target(
    target_id: UUID,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> Response:
    await require_admin_access(session, db)
    deleted = await delete_target(db, target_id=str(target_id))
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Admin target not found.",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sources", response_model=AdminSourcesResponse)
async def get_admin_sources(
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminSourcesResponse:
    await require_admin_access(session, db)
    return await fetch_sources(db)


@router.post(
    "/sources",
    response_model=AdminSource,
    status_code=status.HTTP_201_CREATED,
)
async def post_admin_source(
    payload: CreateSourceRequest,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminSource:
    await require_admin_access(session, db)
    try:
        return await create_source(db, payload=payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.patch("/sources/{source_id}", response_model=AdminSource)
async def patch_admin_source(
    source_id: UUID,
    payload: UpdateSourceRequest,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminSource:
    await require_admin_access(session, db)
    try:
        source = await update_source(db, source_id=str(source_id), payload=payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Content source not found.",
        )

    return source


@router.delete("/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_admin_source(
    source_id: UUID,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> Response:
    await require_admin_access(session, db)
    deleted = await delete_source(db, source_id=str(source_id))
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Content source not found.",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/worker/live", response_model=AdminWorkerLiveResponse)
async def get_worker_live(
    failed_limit: int = Query(default=10, ge=1, le=100),
    failed_offset: int = Query(default=0, ge=0),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminWorkerLiveResponse:
    await require_admin_access(session, db)
    return await fetch_worker_live(
        db,
        failed_limit=failed_limit,
        failed_offset=failed_offset,
    )


@router.get("/videos", response_model=AdminIndexedVideosResponse)
async def get_indexed_videos(
    query: str | None = Query(default=None, max_length=400),
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminIndexedVideosResponse:
    await require_admin_access(session, db)
    return await fetch_indexed_videos(
        db,
        query=query,
        limit=limit,
        offset=offset,
    )


@router.delete("/videos/{video_id}", response_model=AdminDeleteVideoResponse)
async def delete_indexed_video(
    video_id: UUID,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> AdminDeleteVideoResponse:
    await require_admin_access(session, db)
    result = await delete_indexed_video_data(db, video_id=str(video_id))
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Indexed video not found.",
        )
    return result


@router.post("/jobs/{job_id}/retry")
async def retry_failed_job(
    job_id: UUID,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> dict[str, object]:
    await require_admin_access(session, db)
    result = await retry_job(db, job_id=str(job_id))
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found or not in failed state.",
    )
    return {"ok": True, "job_id": str(job_id)}


@router.post("/jobs/{job_id}/kill")
async def kill_failed_job(
    job_id: UUID,
    session: SessionContext = Depends(require_session),
    db: Any = Depends(get_db),
) -> dict[str, object]:
    await require_admin_access(session, db)
    result = await kill_job(db, job_id=str(job_id))
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found or not in failed state.",
        )
    return {"ok": True, "job_id": str(job_id)}
