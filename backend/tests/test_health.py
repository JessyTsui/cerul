import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db import close_pool
from app.main import app


def test_healthz_returns_ok() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_root_reports_environment() -> None:
    with TestClient(app) as client:
        response = client.get("/")

    assert response.status_code == 200
    assert response.json()["name"] == "cerul-api"


def test_app_startup_requires_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    asyncio.run(close_pool())
    monkeypatch.delenv("DATABASE_URL", raising=False)

    with pytest.raises(RuntimeError, match="DATABASE_URL is not set"):
        with TestClient(app):
            pass
