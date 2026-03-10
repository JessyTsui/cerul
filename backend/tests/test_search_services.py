import pytest

from app.db import create_stub_database
from app.routers.search import resolve_search_service
from app.search import resolve_mmr_lambda


def test_resolve_search_service_rejects_unknown_search_type() -> None:
    with pytest.raises(ValueError):
        resolve_search_service("clips", create_stub_database())


def test_resolve_mmr_lambda_uses_default_for_invalid_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MMR_LAMBDA", "not-a-number")

    assert resolve_mmr_lambda() == 0.75


def test_resolve_mmr_lambda_respects_zero_override() -> None:
    assert resolve_mmr_lambda(0.0) == 0.0
