import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.exception_handlers import (
    http_exception_handler as fastapi_http_exception_handler,
)
from fastapi.exception_handlers import (
    request_validation_exception_handler as fastapi_request_validation_exception_handler,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import close_pool, get_pool
from .routers.dashboard import router as dashboard_router
from .routers.health import router as health_router
from .routers.search import router as search_router
from .routers.usage import router as usage_router
from .routers.webhooks import router as webhooks_router
from .search import ErrorDetail, ErrorResponse


def current_environment() -> str:
    return get_settings().environment


def allowed_web_origins() -> list[str]:
    origins = []

    for value in (
        os.getenv("WEB_BASE_URL"),
        os.getenv("NEXT_PUBLIC_SITE_URL"),
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ):
        if not value:
            continue

        normalized = value.rstrip("/")
        if normalized and normalized not in origins:
            origins.append(normalized)

    return origins


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await get_pool()

    try:
        yield
    finally:
        await close_pool()


app = FastAPI(
    title="Cerul API",
    version="0.1.0",
    description=(
        "Thin FastAPI orchestration layer for Cerul. Heavy ingestion and media "
        "processing remain in workers."
    ),
    docs_url="/openapi",
    redoc_url=None,
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_web_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(search_router)
app.include_router(usage_router)
app.include_router(dashboard_router)
app.include_router(webhooks_router)


def error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    payload = ErrorResponse(error=ErrorDetail(code=code, message=message))
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(payload),
        headers=headers,
    )


def uses_public_api_error_shape(request: Request) -> bool:
    return request.url.path.startswith("/v1")


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    if not uses_public_api_error_shape(request):
        return await fastapi_request_validation_exception_handler(request, exc)

    first_error = exc.errors()[0] if exc.errors() else {"msg": "Invalid request"}
    return error_response(400, "invalid_request", str(first_error["msg"]))


@app.exception_handler(HTTPException)
async def http_exception_handler(
    request: Request,
    exc: HTTPException,
) -> JSONResponse:
    if not uses_public_api_error_shape(request):
        return await fastapi_http_exception_handler(request, exc)

    error_code = {
        400: "invalid_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        429: "rate_limited",
    }.get(exc.status_code, "api_error")
    error_message = (
        exc.detail if isinstance(exc.detail, str) else jsonable_encoder(exc.detail)
    )
    normalized_message = str(error_message)
    if normalized_message.endswith("."):
        normalized_message = normalized_message.removesuffix(".")
    return error_response(
        exc.status_code,
        error_code,
        normalized_message,
        headers=exc.headers,
    )


@app.get("/", tags=["meta"])
def read_root() -> dict[str, str]:
    return {
        "name": "cerul-api",
        "status": "ok",
        "environment": current_environment(),
    }


@app.get("/v1/meta", tags=["meta"])
def read_meta() -> dict[str, str]:
    return {
        "service": "cerul-api",
        "framework": "fastapi",
        "environment": current_environment(),
    }
