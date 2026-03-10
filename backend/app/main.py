from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .db import close_pool, database_url_configured, get_pool
from .routers.dashboard import router as dashboard_router
from .routers.health import router as health_router
from .routers.search import router as search_router
from .routers.usage import router as usage_router
from .routers.webhooks import router as webhooks_router
from .search import ErrorDetail, ErrorResponse


def current_environment() -> str:
    return os.getenv("CERUL_ENV", "development")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if database_url_configured():
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

app.include_router(health_router)
app.include_router(search_router)
app.include_router(usage_router)
app.include_router(dashboard_router)
app.include_router(webhooks_router)


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    payload = ErrorResponse(error=ErrorDetail(code=code, message=message))
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(payload),
    )


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    _ = request
    first_error = exc.errors()[0] if exc.errors() else {"msg": "Invalid request"}
    return error_response(400, "invalid_request", str(first_error["msg"]))


@app.exception_handler(HTTPException)
async def http_exception_handler(
    request: Request,
    exc: HTTPException,
) -> JSONResponse:
    _ = request
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
    return error_response(exc.status_code, error_code, str(error_message))


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
