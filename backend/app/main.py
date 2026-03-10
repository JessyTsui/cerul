import os

from fastapi import FastAPI

from .routers.health import router as health_router


def current_environment() -> str:
    return os.getenv("CERUL_ENV", "development")


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
)

app.include_router(health_router)


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
