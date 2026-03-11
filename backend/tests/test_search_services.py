import asyncio
import logging

import pytest
import httpx

from app.routers.search import resolve_search_service
from app.search.broll import BrollSearchService
from app.search.answer import AnswerGenerator, OpenAICompatibleAnswerBackend
from app.search import resolve_mmr_lambda
from app.search.base import (
    DEFAULT_BROLL_VECTOR_DIMENSION,
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    build_placeholder_vector,
    vector_to_literal,
)
from app.search.knowledge import KnowledgeSearchService
from app.search.models import SearchRequest
from app.search.rerank import LLMReranker, OpenAICompatibleRerankerBackend


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


class StaticReranker:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[str]]] = []
        self.top_n = 20

    async def rerank(
        self,
        query: str,
        candidates: list[dict[str, object]],
        top_n: int | None = None,
    ) -> list[dict[str, object]]:
        self.calls.append((query, [str(candidate["id"]) for candidate in candidates]))
        return [dict(candidate) for candidate in candidates]


class RecordingAnswerGenerator:
    def __init__(self, answer: str | None = None) -> None:
        self.answer = answer
        self.calls: list[tuple[str, list[str]]] = []

    async def generate(
        self,
        query: str,
        segments: list[dict[str, object]],
    ) -> str | None:
        self.calls.append((query, [str(segment["id"]) for segment in segments]))
        return self.answer


class FakeHTTPResponse:
    def __init__(self, payload: dict[str, object], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code
        self.request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")

    def json(self) -> dict[str, object]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            response = httpx.Response(self.status_code, request=self.request)
            raise httpx.HTTPStatusError(
                "request failed",
                request=self.request,
                response=response,
            )


def install_async_client(
    monkeypatch: pytest.MonkeyPatch,
    *,
    responses: list[object],
    requests: list[dict[str, object]],
) -> None:
    class StubAsyncClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "StubAsyncClient":
            return self

        async def __aexit__(
            self,
            exc_type: object,
            exc: object,
            traceback: object,
        ) -> bool:
            return False

        async def post(
            self,
            url: str,
            *,
            headers: dict[str, str],
            json: dict[str, object],
        ) -> FakeHTTPResponse:
            requests.append(
                {
                    "url": url,
                    "headers": headers,
                    "json": json,
                }
            )
            next_response = responses.pop(0)
            if isinstance(next_response, Exception):
                raise next_response
            return next_response

    monkeypatch.setattr(httpx, "AsyncClient", StubAsyncClient)


def build_knowledge_row(
    *,
    row_id: str,
    score: float,
    embedding: list[float],
    title: str = "OpenAI Dev Day Keynote",
    segment_title: str = "Agent workflows and reasoning models",
    transcript_text: str = "Agents can use reasoning models to plan and execute tasks more reliably.",
    visual_summary: str = "Presenter speaking on stage with slides about agent workflows.",
    timestamp_start: float = 120.0,
    timestamp_end: float = 178.5,
) -> dict[str, object]:
    return {
        "id": row_id,
        "title": title,
        "segment_title": segment_title,
        "description": "Discussion about agent workflows and reasoning models.",
        "transcript_text": transcript_text,
        "visual_summary": visual_summary,
        "video_url": "https://example.com/keynote.mp4",
        "thumbnail_url": "https://example.com/keynote.jpg",
        "duration": 3600,
        "source": "youtube",
        "license": "standard-youtube-license",
        "speaker": "Sam Altman",
        "published_at": "2025-11-06T00:00:00Z",
        "timestamp_start": timestamp_start,
        "timestamp_end": timestamp_end,
        "embedding": embedding,
        "score": score,
    }


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
            build_knowledge_row(
                row_id="segment_1",
                score=0.88,
                embedding=embedded_vector,
            )
        ]
    )
    embedding_backend = FakeEmbeddingBackend(embedded_vector)
    service = KnowledgeSearchService(
        database,
        embedding_backend=embedding_backend,
        reranker=StaticReranker(),
    )
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


def test_llm_reranker_reorders_candidates_by_llm_score(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, object]] = []
    responses: list[object] = [
        FakeHTTPResponse({"choices": [{"message": {"content": '{"score": 2}'}}]}),
        FakeHTTPResponse({"choices": [{"message": {"content": '{"score": 9}'}}]}),
        FakeHTTPResponse({"choices": [{"message": {"content": '{"score": 6}'}}]}),
    ]
    install_async_client(monkeypatch, responses=responses, requests=requests)

    embedding = build_placeholder_vector(
        "reranker candidate embedding",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    candidates = [
        build_knowledge_row(row_id="segment_1", score=0.90, embedding=embedding),
        build_knowledge_row(row_id="segment_2", score=0.80, embedding=embedding),
        build_knowledge_row(row_id="segment_3", score=0.70, embedding=embedding),
    ]
    reranker = LLMReranker(
        backend=OpenAICompatibleRerankerBackend(api_key="test-openai-key"),
        top_n=3,
    )

    reranked = asyncio.run(reranker.rerank("agent workflows", candidates))

    assert [candidate["id"] for candidate in reranked] == [
        "segment_2",
        "segment_3",
        "segment_1",
    ]
    assert reranked[0]["rerank_score"] == pytest.approx(0.9)
    assert len(requests) == 3
    assert requests[0]["url"] == "https://api.openai.com/v1/chat/completions"


def test_llm_reranker_falls_back_to_original_order_on_api_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, object]] = []
    responses: list[object] = [httpx.ConnectError("boom")]
    install_async_client(monkeypatch, responses=responses, requests=requests)

    embedding = build_placeholder_vector(
        "reranker fallback embedding",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    candidates = [
        build_knowledge_row(row_id="segment_low", score=0.40, embedding=embedding),
        build_knowledge_row(row_id="segment_high", score=0.95, embedding=embedding),
    ]
    reranker = LLMReranker(
        backend=OpenAICompatibleRerankerBackend(api_key="test-openai-key"),
        top_n=1,
    )

    reranked = asyncio.run(reranker.rerank("agent workflows", candidates))

    assert [candidate["id"] for candidate in reranked] == [
        "segment_high",
        "segment_low",
    ]
    assert len(requests) == 1


def test_answer_generator_produces_answer_with_citations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, object]] = []
    responses: list[object] = [
        FakeHTTPResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": (
                                "The speaker says agents can plan and execute tasks more "
                                "reliably with reasoning models [OpenAI Dev Day Keynote, 2:00-2:58]."
                            )
                        }
                    }
                ]
            }
        )
    ]
    install_async_client(monkeypatch, responses=responses, requests=requests)

    generator = AnswerGenerator(
        backend=OpenAICompatibleAnswerBackend(api_key="test-openai-key")
    )
    segments = [
        build_knowledge_row(
            row_id="segment_1",
            score=0.88,
            embedding=build_placeholder_vector(
                "answer generator embedding",
                DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
            ),
        )
    ]

    answer = asyncio.run(generator.generate("agent workflows", segments))

    assert answer is not None
    assert "[OpenAI Dev Day Keynote, 2:00-2:58]" in answer
    assert len(requests) == 1
    assert "Retrieved evidence segments" in str(requests[0]["json"])


def test_answer_generator_returns_none_on_api_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, object]] = []
    responses: list[object] = [httpx.ConnectError("boom")]
    install_async_client(monkeypatch, responses=responses, requests=requests)

    generator = AnswerGenerator(
        backend=OpenAICompatibleAnswerBackend(api_key="test-openai-key")
    )
    segments = [
        build_knowledge_row(
            row_id="segment_1",
            score=0.88,
            embedding=build_placeholder_vector(
                "answer generator error embedding",
                DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
            ),
        )
    ]

    answer = asyncio.run(generator.generate("agent workflows", segments))

    assert answer is None
    assert len(requests) == 1


def test_knowledge_search_skips_answer_generation_when_include_answer_false() -> None:
    embedding = build_placeholder_vector(
        "knowledge search skip answer",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        [build_knowledge_row(row_id="segment_1", score=0.88, embedding=embedding)]
    )
    answer_generator = RecordingAnswerGenerator(
        answer="Shared answer [OpenAI Dev Day Keynote, 2:00-2:58]."
    )
    service = KnowledgeSearchService(
        database,
        embedding_backend=FakeEmbeddingBackend(embedding),
        reranker=StaticReranker(),
        answer_generator=answer_generator,
    )
    request = SearchRequest.model_validate(
        {
            "query": "agent workflows",
            "search_type": "knowledge",
            "max_results": 1,
            "include_answer": False,
        }
    )

    results = asyncio.run(service.search(request))

    assert len(results) == 1
    assert results[0].answer is None
    assert answer_generator.calls == []


def test_knowledge_search_includes_answer_when_include_answer_true() -> None:
    embedding = build_placeholder_vector(
        "knowledge search include answer",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        [build_knowledge_row(row_id="segment_1", score=0.88, embedding=embedding)]
    )
    answer_text = (
        "Reasoning models help agents plan tasks more reliably "
        "[OpenAI Dev Day Keynote, 2:00-2:58]."
    )
    answer_generator = RecordingAnswerGenerator(answer=answer_text)
    service = KnowledgeSearchService(
        database,
        embedding_backend=FakeEmbeddingBackend(embedding),
        reranker=StaticReranker(),
        answer_generator=answer_generator,
    )
    request = SearchRequest.model_validate(
        {
            "query": "agent workflows",
            "search_type": "knowledge",
            "max_results": 1,
            "include_answer": True,
        }
    )

    results = asyncio.run(service.search(request))

    assert len(results) == 1
    assert results[0].answer == answer_text
    assert answer_generator.calls == [("agent workflows", ["segment_1"])]
