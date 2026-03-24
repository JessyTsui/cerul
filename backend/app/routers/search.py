from __future__ import annotations

from contextlib import asynccontextmanager
import json
import logging
import time
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Request,
    status,
)
from pydantic import ValidationError

from app.auth import AuthContext, require_api_key
from app.billing import (
    InsufficientCreditsError,
    calculate_credits_remaining,
    deduct_credits,
    fetch_usage_summary,
    refund_credits,
)
from app.db import get_db
from app.search import (
    ErrorResponse,
    SearchExecution,
    SearchRequest,
    SearchResponse,
    UnifiedSearchService,
)
from app.search.query_image import (
    cleanup_local_image,
    resolve_image_to_local,
    upload_query_image_to_r2,
)

router = APIRouter(
    prefix="/v1",
    tags=["search"],
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)

LOGGER = logging.getLogger(__name__)


@asynccontextmanager
async def transaction_context(db: Any) -> AsyncIterator[Any]:
    async with db.transaction():
        yield db


def generate_request_id() -> str:
    import secrets

    return f"req_{secrets.token_hex(12)}"


def resolve_search_service(search_type: str | None, db: Any) -> UnifiedSearchService:
    normalized_search_type = (search_type or "unified").strip().lower()
    if normalized_search_type != "unified":
        raise ValueError(f"Unsupported search_type: {search_type}")
    return UnifiedSearchService(db)


async def append_query_log(
    db: Any,
    *,
    request_id: str,
    auth: AuthContext,
    payload: SearchRequest,
    results_count: int,
    latency_ms: int | None,
) -> None:
    filters_payload = payload.model_dump(mode="json").get("filters")

    await db.execute(
        """
        INSERT INTO query_logs (
            request_id,
            user_id,
            api_key_id,
            search_type,
            query_text,
            filters,
            max_results,
            include_answer,
            result_count,
            latency_ms
        )
        VALUES ($1, $2, $3::uuid, $4, $5, $6::jsonb, $7, $8, $9, $10)
        """,
        request_id,
        auth.user_id,
        auth.api_key_id,
        "unified",
        payload.query or "",
        json.dumps(filters_payload or {}),
        payload.max_results,
        payload.include_answer,
        results_count,
        latency_ms,
    )


async def append_tracking_links(
    db: Any,
    *,
    execution: SearchExecution,
) -> None:
    for tracking_link in execution.tracking_links:
        await db.execute(
            """
            INSERT INTO tracking_links (
                short_id,
                request_id,
                result_rank,
                unit_id,
                video_id,
                target_url,
                title,
                thumbnail_url,
                source,
                speaker,
                unit_type,
                timestamp_start,
                timestamp_end,
                transcript,
                visual_desc,
                keyframe_url
            )
            VALUES (
                $1,
                $2,
                $3,
                $4::uuid,
                $5::uuid,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                $12,
                $13,
                $14,
                $15,
                $16
            )
            ON CONFLICT (short_id) DO NOTHING
            """,
            tracking_link["short_id"],
            tracking_link["request_id"],
            tracking_link["result_rank"],
            tracking_link["unit_id"],
            tracking_link["video_id"],
            tracking_link["target_url"],
            tracking_link.get("title"),
            tracking_link.get("thumbnail_url"),
            tracking_link.get("source"),
            tracking_link.get("speaker"),
            tracking_link.get("unit_type"),
            tracking_link.get("timestamp_start"),
            tracking_link.get("timestamp_end"),
            tracking_link.get("transcript"),
            tracking_link.get("visual_desc"),
            tracking_link.get("keyframe_url"),
        )


async def _execute_search_request(
    *,
    payload: SearchRequest,
    image_path: str | None,
    auth: AuthContext,
    db: Any,
    request_id: str,
    request_started_at: float,
) -> SearchResponse:
    service = resolve_search_service("unified", db)
    credits_used = 0

    try:
        credits_used = await deduct_credits(
            db,
            auth.user_id,
            auth.api_key_id,
            request_id,
            "unified",
            payload.include_answer,
        )
        execution = await service.search(
            payload,
            user_id=auth.user_id,
            request_id=request_id,
            image_path=None if image_path is None else Path(image_path),
        )
        async with transaction_context(db) as transactional_db:
            await append_query_log(
                transactional_db,
                request_id=request_id,
                auth=auth,
                payload=payload,
                results_count=len(execution.results),
                latency_ms=max(
                    int((time.perf_counter() - request_started_at) * 1000),
                    0,
                ),
            )
            await append_tracking_links(
                transactional_db,
                execution=execution,
            )
            usage_summary = await fetch_usage_summary(transactional_db, auth.user_id)
    except InsufficientCreditsError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient credits for this request.",
        ) from exc
    except BaseException:
        if credits_used > 0:
            try:
                await refund_credits(db, request_id)
            except Exception as refund_exc:  # pragma: no cover - best effort logging
                LOGGER.warning(
                    "Failed to refund reserved credits for request %s: %s",
                    request_id,
                    refund_exc,
                )
        raise

    return SearchResponse(
        results=execution.results,
        answer=execution.answer,
        credits_used=credits_used,
        credits_remaining=calculate_credits_remaining(usage_summary),
        request_id=request_id,
    )


def _raise_invalid_image_request(exc: Exception) -> None:
    if isinstance(exc, HTTPException):
        raise exc
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=str(exc),
    ) from exc


def _build_search_request(payload: dict[str, Any]) -> SearchRequest:
    try:
        return SearchRequest.model_validate(payload)
    except ValidationError as exc:
        first_error = exc.errors()[0] if exc.errors() else {"msg": "Invalid request"}
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(first_error["msg"]),
        ) from exc


def _parse_optional_bool(value: Any, *, field_name: str, default: bool) -> bool:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "on"}:
        return True
    if normalized in {"false", "0", "no", "off"}:
        return False
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"{field_name} must be a boolean.",
    )


def _parse_optional_int(value: Any, *, field_name: str, default: int) -> int:
    if value in (None, ""):
        return default
    try:
        return int(str(value).strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be an integer.",
        ) from exc


async def _build_search_request_from_http_request(request: Request) -> tuple[SearchRequest, Path | None]:
    content_type = request.headers.get("content-type", "").lower()
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        image_file = form.get("image_file")
        image_path: Path | None = None
        if image_file is not None:
            try:
                file_bytes = await image_file.read()
                image_path, _mime_type = await resolve_image_to_local(
                    file_bytes=file_bytes,
                    file_content_type=getattr(image_file, "content_type", None),
                )
            except (ValueError, httpx.HTTPError) as exc:
                _raise_invalid_image_request(exc)

        payload: dict[str, Any] = {
            "query": form.get("query"),
            "max_results": _parse_optional_int(
                form.get("max_results"),
                field_name="max_results",
                default=10,
            ),
            "include_answer": _parse_optional_bool(
                form.get("include_answer"),
                field_name="include_answer",
                default=False,
            ),
            "ranking_mode": form.get("ranking_mode") or "embedding",
            "include_summary": _parse_optional_bool(
                form.get("include_summary"),
                field_name="include_summary",
                default=False,
            ),
        }
        filters = form.get("filters")
        if filters not in (None, ""):
            try:
                payload["filters"] = json.loads(str(filters))
            except json.JSONDecodeError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="filters must be valid JSON.",
                ) from exc
        if image_path is not None:
            payload["image"] = {"base64": "multipart-upload"}
        return _build_search_request(payload), image_path

    try:
        raw_payload = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request body must be valid JSON.",
        ) from exc

    if not isinstance(raw_payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request body must be a JSON object.",
        )

    payload = _build_search_request(raw_payload)
    image_path = None
    if payload.image is not None:
        try:
            image_path, _mime_type = await resolve_image_to_local(
                url=str(payload.image.url) if payload.image.url is not None else None,
                base64_str=payload.image.base64,
            )
        except (ValueError, httpx.HTTPError) as exc:
            _raise_invalid_image_request(exc)
    return payload, image_path


@router.post("/search", response_model=SearchResponse, response_model_exclude_none=True)
async def search_v1(
    request: Request,
    background_tasks: BackgroundTasks,
    auth: AuthContext = Depends(require_api_key),
    db: Any = Depends(get_db),
) -> SearchResponse:
    request_started_at = time.perf_counter()
    request_id = generate_request_id()
    image_path: Path | None = None
    cleanup_scheduled = False

    try:
        payload, image_path = await _build_search_request_from_http_request(request)
        response = await _execute_search_request(
            payload=payload,
            image_path=None if image_path is None else str(image_path),
            auth=auth,
            db=db,
            request_id=request_id,
            request_started_at=request_started_at,
        )
        if image_path is not None:
            background_tasks.add_task(
                upload_query_image_to_r2,
                image_path,
                request_id=request_id,
            )
            background_tasks.add_task(cleanup_local_image, image_path)
            cleanup_scheduled = True
        return response
    finally:
        if image_path is not None and image_path.exists() and not cleanup_scheduled:
            cleanup_local_image(image_path)
