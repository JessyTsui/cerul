import asyncio
import logging

import pytest

from app.routers.search import resolve_search_service
from app.search.broll import BrollSearchService
from app.search import resolve_mmr_lambda
from app.search.base import (
    DEFAULT_BROLL_VECTOR_DIMENSION,
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    build_placeholder_vector,
    vector_to_literal,
)
from app.search.knowledge import KnowledgeSearchService
from app.search.models import SearchRequest


class FakeEmbeddingBackend:
    name = "fake-gemini"

    def __init__(self, vector: list[float]) -> None:
        self._vector = vector
        self.calls: list[str] = []

    def dimension(self) -> int:
        return len(self._vector)

    def embed_text(self, text: str) -> list[float]:
        self.calls.append(text)
        return list(self._vector)


class FakeDatabase:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetch(self, sql: str, *params: object) -> list[dict[str, object]]:
        self.fetch_calls.append((sql, params))
        return self.rows


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


def test_broll_search_embeds_query_text_and_logs_dimension(caplog: pytest.LogCaptureFixture) -> None:
    query_vector = build_placeholder_vector(
        "cinematic drone shot",
        DEFAULT_BROLL_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        [
            {
                "id": "asset_1",
                "title": "Aerial drone shot of coastal highway",
                "description": "Golden-hour footage of a coastal road.",
                "video_url": "https://example.com/coastal.mp4",
                "thumbnail_url": "https://example.com/coastal.jpg",
                "duration": 18,
                "source": "pexels",
                "license": "pexels-license",
                "embedding": query_vector,
                "score": 0.95,
            }
        ]
    )
    embedding_backend = FakeEmbeddingBackend(query_vector)
    service = BrollSearchService(database, embedding_backend=embedding_backend)
    request = SearchRequest.model_validate(
        {
            "query": "cinematic drone shot",
            "search_type": "broll",
            "max_results": 1,
        }
    )

    with caplog.at_level(logging.INFO):
        results = asyncio.run(service.search(request))

    assert len(results) == 1
    assert results[0].id == "asset_1"
    assert embedding_backend.calls == ["cinematic drone shot"]
    assert database.fetch_calls[0][1][0] == vector_to_literal(query_vector)
    assert "Resolved broll query vector with 768 dimensions via fake-gemini" in caplog.text


def test_knowledge_search_prefers_explicit_query_vector_over_embedding_backend() -> None:
    embedded_vector = build_placeholder_vector(
        "agent workflows",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    explicit_vector = build_placeholder_vector(
        "provided query vector",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        [
            {
                "id": "segment_1",
                "title": "Agent workflows and reasoning models",
                "description": "Discussion about agent workflows and reasoning models.",
                "video_url": "https://example.com/keynote.mp4",
                "thumbnail_url": "https://example.com/keynote.jpg",
                "duration": 3600,
                "source": "youtube",
                "license": "standard-youtube-license",
                "timestamp_start": 120.0,
                "timestamp_end": 178.5,
                "embedding": embedded_vector,
                "score": 0.88,
            }
        ]
    )
    embedding_backend = FakeEmbeddingBackend(embedded_vector)
    service = KnowledgeSearchService(database, embedding_backend=embedding_backend)
    request = SearchRequest.model_validate(
        {
            "query": "agent workflows",
            "search_type": "knowledge",
            "max_results": 1,
        }
    )

    results = asyncio.run(service.search(request, query_vector=explicit_vector))

    assert len(results) == 1
    assert results[0].id == "segment_1"
    assert embedding_backend.calls == []
    assert database.fetch_calls[0][1][0] == vector_to_literal(explicit_vector)
