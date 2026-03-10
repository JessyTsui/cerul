from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz_returns_ok() -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_root_reports_environment() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["name"] == "cerul-api"
