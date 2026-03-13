from __future__ import annotations

from contextlib import asynccontextmanager
import json
import secrets
import time
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import AuthContext, require_api_key
from app.billing import (
    InsufficientCreditsError,
    calculate_credit_cost,
    calculate_credits_remaining,
    deduct_credits,
    fetch_usage_summary,
)
from app.db import get_db
from app.search import (
    BrollSearchService,
    ErrorResponse,
    KnowledgeSearchService,
    SearchRequest,
    SearchResponse,
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


@asynccontextmanager
async def transaction_context(db: Any) -> AsyncIterator[Any]:
    async with db.transaction():
        yield db


def generate_request_id() -> str:
    return f"req_{secrets.token_hex(12)}"


def resolve_search_service(search_type: str, db: Any) -> BrollSearchService | KnowledgeSearchService:
    if search_type == "broll":
        return BrollSearchService(db)
    if search_type == "knowledge":
        return KnowledgeSearchService(db)
    raise ValueError(f"Unsupported search_type: {search_type}")


async def ensure_request_credits_available(
    db: Any,
    auth: AuthContext,
    payload: SearchRequest,
) -> None:
    request_credit_cost = calculate_credit_cost(
        payload.search_type,
        payload.include_answer,
    )

    usage_summary = await fetch_usage_summary(db, auth.user_id)
    credits_remaining = calculate_credits_remaining(usage_summary)

    if credits_remaining < request_credit_cost:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient credits for this request.",
        )


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
        payload.search_type,
        payload.query,
        json.dumps(filters_payload or {}),
        payload.max_results,
        payload.include_answer,
        results_count,
        latency_ms,
    )


@router.post("/search", response_model=SearchResponse, response_model_exclude_none=True)
async def search_v1(
    payload: SearchRequest,
    auth: AuthContext = Depends(require_api_key),
    db: Any = Depends(get_db),
) -> SearchResponse:
    request_started_at = time.perf_counter()
    request_id = generate_request_id()
    await ensure_request_credits_available(db, auth, payload)
    service = resolve_search_service(payload.search_type, db)
    results = await service.search(payload)

    try:
        async with transaction_context(db) as transactional_db:
            credits_used = await deduct_credits(
                transactional_db,
                auth.user_id,
                auth.api_key_id,
                request_id,
                payload.search_type,
                payload.include_answer,
            )
            await append_query_log(
                transactional_db,
                request_id=request_id,
                auth=auth,
                payload=payload,
                results_count=len(results),
                latency_ms=max(
                    int((time.perf_counter() - request_started_at) * 1000),
                    0,
                ),
            )
            usage_summary = await fetch_usage_summary(transactional_db, auth.user_id)
    except InsufficientCreditsError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    return SearchResponse(
        results=results,
        credits_used=credits_used,
        credits_remaining=calculate_credits_remaining(usage_summary),
        request_id=request_id,
    )
