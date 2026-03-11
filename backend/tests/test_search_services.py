import pytest

from app.routers.search import resolve_search_service
from app.search import resolve_mmr_lambda
from app.search.base import (
    DEFAULT_BROLL_VECTOR_DIMENSION,
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    build_placeholder_vector,
)


def test_resolve_search_service_rejects_unknown_search_type() -> None:
    with pytest.raises(ValueError):
        resolve_search_service("clips", object())


def test_resolve_mmr_lambda_uses_default_for_invalid_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MMR_LAMBDA", "not-a-number")

    assert resolve_mmr_lambda() == 0.75


def test_resolve_mmr_lambda_respects_zero_override() -> None:
    assert resolve_mmr_lambda(0.0) == 0.0


def test_placeholder_query_vectors_match_768_embedding_schema() -> None:
    assert DEFAULT_BROLL_VECTOR_DIMENSION == 768
    assert DEFAULT_KNOWLEDGE_VECTOR_DIMENSION == 768
    assert len(build_placeholder_vector("cinematic drone shot", DEFAULT_BROLL_VECTOR_DIMENSION)) == 768
    assert len(build_placeholder_vector("agent workflows", DEFAULT_KNOWLEDGE_VECTOR_DIMENSION)) == 768
