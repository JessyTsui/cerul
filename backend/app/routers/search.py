from __future__ import annotations

from contextlib import asynccontextmanager
import json
import secrets
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends

from app.auth import AuthContext, require_api_key
from app.billing import calculate_credits_remaining, deduct_credits, fetch_usage_summary
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
    if hasattr(db, "transaction"):
        async with db.transaction():
            yield db
        return

    yield db


def generate_request_id() -> str:
    return f"req_{secrets.token_hex(12)}"


def resolve_search_service(search_type: str, db: Any) -> BrollSearchService | KnowledgeSearchService:
    if search_type == "broll":
        return BrollSearchService(db)
    if search_type == "knowledge":
        return KnowledgeSearchService(db)
    raise ValueError(f"Unsupported search_type: {search_type}")


async def append_query_log(
    db: Any,
    *,
    request_id: str,
    auth: AuthContext,
    payload: SearchRequest,
    results_count: int,
) -> None:
    filters_payload = payload.model_dump(mode="json").get("filters")
    if hasattr(db, "append_query_log"):
        await db.append_query_log(
            request_id=request_id,
            user_id=auth.user_id,
            api_key_id=auth.api_key_id,
            search_type=payload.search_type,
            query_text=payload.query,
            include_answer=payload.include_answer,
            filters=filters_payload,
            results_count=results_count,
        )
        return

    await db.execute(
        """
        INSERT INTO query_logs (
            request_id,
            user_id,
            api_key_id,
            search_type,
            query_text,
            include_answer,
            filters_json,
            results_count
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        """,
        request_id,
        auth.user_id,
        auth.api_key_id,
        payload.search_type,
        payload.query,
        payload.include_answer,
        json.dumps(filters_payload),
        results_count,
    )


@router.post("/search", response_model=SearchResponse, response_model_exclude_none=True)
async def search_v1(
    payload: SearchRequest,
    auth: AuthContext = Depends(require_api_key),
    db: Any = Depends(get_db),
) -> SearchResponse:
    request_id = generate_request_id()
    service = resolve_search_service(payload.search_type, db)
    results = await service.search(payload)

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
        )
        usage_summary = await fetch_usage_summary(transactional_db, auth.user_id)

    return SearchResponse(
        results=results,
        credits_used=credits_used,
        credits_remaining=calculate_credits_remaining(usage_summary),
        request_id=request_id,
    )
