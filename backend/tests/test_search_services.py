import asyncio
import logging
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from app.routers.search import resolve_search_service
from app.search import resolve_mmr_lambda
from app.search.answer import (
    AnswerGenerator,
    OpenAICompatibleAnswerBackend,
    build_answer_prompt,
)
from app.search.base import (
    DEFAULT_BROLL_VECTOR_DIMENSION,
    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    build_placeholder_vector,
    vector_to_literal,
)
from app.search.models import SearchRequest
from app.search.rerank import (
    DEFAULT_RERANK_MODEL,
    LLMReranker,
    OpenAICompatibleRerankerBackend,
    _build_default_backend,
)
from app.search.unified import UnifiedSearchService


class FakeEmbeddingBackend:
    name = "fake-gemini"

    def __init__(self, vector: list[float]) -> None:
        self._vector = vector
        self.calls: list[str] = []
        self.multimodal_calls: list[tuple[str | None, str | None]] = []

    def dimension(self) -> int:
        return len(self._vector)

    def embed_text(self, text: str) -> list[float]:
        self.calls.append(text)
        return list(self._vector)

    def embed_query(self, text: str) -> list[float]:
        return self.embed_text(text)

    def embed_query_with_image(
        self,
        text: str | None = None,
        *,
        image_path: str | Path | None = None,
    ) -> list[float]:
        resolved_path = None if image_path is None else str(image_path)
        self.multimodal_calls.append((text, resolved_path))
        return list(self._vector)


class FakeDatabase:
    def __init__(self, rows_by_unit_type: dict[str, list[dict[str, object]]]) -> None:
        self.rows_by_unit_type = rows_by_unit_type
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetch(self, sql: str, *params: object) -> list[dict[str, object]]:
        self.fetch_calls.append((sql, params))
        unit_type = str(params[1])
        return self.rows_by_unit_type.get(unit_type, [])


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


class ReorderingReranker:
    def __init__(self, ordered_ids: list[str]) -> None:
        self._ordered_ids = ordered_ids
        self.calls: list[tuple[str, list[str]]] = []
        self.top_n = 20

    async def rerank(
        self,
        query: str,
        candidates: list[dict[str, object]],
        top_n: int | None = None,
    ) -> list[dict[str, object]]:
        self.calls.append((query, [str(candidate["id"]) for candidate in candidates]))
        candidates_by_id = {str(candidate["id"]): dict(candidate) for candidate in candidates}
        ordered: list[dict[str, object]] = []
        for index, candidate_id in enumerate(self._ordered_ids):
            candidate = candidates_by_id.pop(candidate_id, None)
            if candidate is None:
                continue
            candidate["rerank_score"] = max(1.0 - (index * 0.1), 0.0)
            ordered.append(candidate)
        ordered.extend(candidates_by_id.values())
        return ordered


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


def build_unified_row(
    *,
    row_id: str,
    score: float,
    embedding: list[float],
    unit_type: str = "speech",
    title: str = "OpenAI Dev Day Keynote",
    transcript_text: str = "Agents can use reasoning models to plan and execute tasks more reliably.",
    visual_summary: str = "Presenter speaking on stage with slides about agent workflows.",
    timestamp_start: float = 120.0,
    timestamp_end: float = 178.5,
) -> dict[str, object]:
    return {
        "id": row_id,
        "video_id": "video_1",
        "unit_type": unit_type,
        "unit_index": 0,
        "content_text": f"{title}\n{transcript_text}",
        "transcript_text": transcript_text,
        "visual_description": visual_summary,
        "visual_summary": visual_summary,
        "visual_text_content": "Agent workflows",
        "segment_title": "Agent workflows and reasoning models",
        "visual_type": "slide",
        "keyframe_url": "https://example.com/keyframe.jpg",
        "timestamp_start": timestamp_start,
        "timestamp_end": timestamp_end,
        "embedding": embedding,
        "score": score,
        "title": title,
        "description": "Discussion about agent workflows and reasoning models.",
        "source": "youtube",
        "source_url": "https://www.youtube.com/watch?v=openai-devday",
        "video_url": "https://www.youtube.com/watch?v=openai-devday",
        "thumbnail_url": "https://example.com/keynote.jpg",
        "duration": 3600,
        "speaker": "Sam Altman",
        "license": "standard-youtube-license",
        "creator": "OpenAI",
        "published_at": "2025-11-06T00:00:00Z",
    }


def test_resolve_search_service_rejects_unknown_search_type() -> None:
    with pytest.raises(ValueError):
        resolve_search_service("clips", object())


def test_resolve_search_service_accepts_only_unified() -> None:
    assert isinstance(resolve_search_service("unified", object()), UnifiedSearchService)
    assert isinstance(resolve_search_service(None, object()), UnifiedSearchService)
    with pytest.raises(ValueError):
        resolve_search_service("broll", object())
    with pytest.raises(ValueError):
        resolve_search_service("knowledge", object())


def test_resolve_mmr_lambda_uses_default_for_invalid_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MMR_LAMBDA", "not-a-number")

    assert resolve_mmr_lambda() == 0.75


def test_placeholder_query_vectors_match_embedding_schemas() -> None:
    assert DEFAULT_BROLL_VECTOR_DIMENSION == 768
    assert DEFAULT_KNOWLEDGE_VECTOR_DIMENSION == 3072
    assert len(build_placeholder_vector("cinematic drone shot", DEFAULT_BROLL_VECTOR_DIMENSION)) == 768
    assert len(build_placeholder_vector("agent workflows", DEFAULT_KNOWLEDGE_VECTOR_DIMENSION)) == 3072


def test_unified_search_embeds_query_text_and_returns_tracking_url(
    caplog: pytest.LogCaptureFixture,
) -> None:
    query_vector = build_placeholder_vector(
        "agent workflows",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        {
            "speech": [
                build_unified_row(
                    row_id="segment_1",
                    score=0.88,
                    embedding=query_vector,
                )
            ]
        }
    )
    embedding_backend = FakeEmbeddingBackend(query_vector)
    service = UnifiedSearchService(
        database,
        embedding_backend=embedding_backend,
        reranker=StaticReranker(),
    )
    request = SearchRequest.model_validate(
        {
            "query": "agent workflows",
            "max_results": 1,
        }
    )

    with caplog.at_level(logging.INFO):
        execution = asyncio.run(
            service.search(
                request,
                user_id="user_stub",
                request_id="req_123",
            )
        )

    assert len(execution.results) == 1
    assert execution.results[0].id == "segment_1"
    assert execution.results[0].url.path.startswith("/v/")
    assert execution.results[0].unit_type == "speech"
    assert embedding_backend.calls == ["agent workflows"]
    assert database.fetch_calls[0][1][0] == vector_to_literal(query_vector)
    assert "Resolved unified query vector with 3072 dimensions via fake-gemini" in caplog.text


def test_unified_search_embeds_image_only_query(tmp_path: Path) -> None:
    query_vector = build_placeholder_vector(
        "fireplace interview image",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    image_path = tmp_path / "query.jpg"
    image_path.write_bytes(b"image-bytes")
    database = FakeDatabase(
        {
            "visual": [
                build_unified_row(
                    row_id="visual_1",
                    unit_type="visual",
                    score=0.91,
                    embedding=query_vector,
                    visual_summary="A man and a woman sit in a room with a fireplace.",
                )
            ]
        }
    )
    embedding_backend = FakeEmbeddingBackend(query_vector)
    service = UnifiedSearchService(
        database,
        embedding_backend=embedding_backend,
        reranker=StaticReranker(),
    )

    execution = asyncio.run(
        service.search(
            SearchRequest.model_validate(
                {
                    "image": {
                        "base64": "aGVsbG8=",
                    },
                    "max_results": 1,
                }
            ),
            user_id="user_stub",
            request_id="req_123",
            image_path=image_path,
        )
    )

    assert len(execution.results) == 1
    assert execution.results[0].unit_type == "visual"
    assert embedding_backend.calls == []
    assert embedding_backend.multimodal_calls == [(None, str(image_path))]


def test_unified_search_embeds_text_and_image_query(tmp_path: Path) -> None:
    query_vector = build_placeholder_vector(
        "fireplace interview multimodal",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    image_path = tmp_path / "query.jpg"
    image_path.write_bytes(b"image-bytes")
    database = FakeDatabase(
        {
            "visual": [
                build_unified_row(
                    row_id="visual_1",
                    unit_type="visual",
                    score=0.91,
                    embedding=query_vector,
                    visual_summary="A man and a woman sit in a room with a fireplace.",
                )
            ]
        }
    )
    embedding_backend = FakeEmbeddingBackend(query_vector)
    service = UnifiedSearchService(
        database,
        embedding_backend=embedding_backend,
        reranker=StaticReranker(),
    )

    execution = asyncio.run(
        service.search(
            SearchRequest.model_validate(
                {
                    "query": "fireplace interview",
                    "image": {
                        "base64": "aGVsbG8=",
                    },
                    "max_results": 1,
                }
            ),
            user_id="user_stub",
            request_id="req_123",
            image_path=image_path,
        )
    )

    assert len(execution.results) == 1
    assert execution.results[0].unit_type == "visual"
    assert embedding_backend.calls == []
    assert embedding_backend.multimodal_calls == [("fireplace interview", str(image_path))]


def test_unified_search_excludes_summary_results_by_default() -> None:
    query_vector = build_placeholder_vector(
        "memory advantage",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        {
            "summary": [
                build_unified_row(
                    row_id="summary_1",
                    unit_type="summary",
                    score=0.99,
                    embedding=query_vector,
                    timestamp_start=None,
                    timestamp_end=None,
                )
            ],
            "speech": [
                build_unified_row(
                    row_id="segment_1",
                    unit_type="speech",
                    score=0.87,
                    embedding=query_vector,
                )
            ],
        }
    )
    reranker = StaticReranker()
    service = UnifiedSearchService(
        database,
        embedding_backend=FakeEmbeddingBackend(query_vector),
        reranker=reranker,
    )

    execution = asyncio.run(
        service.search(
            SearchRequest.model_validate(
                {
                    "query": "memory advantage",
                    "max_results": 1,
                }
            ),
            user_id="user_stub",
            request_id="req_123",
        )
    )

    assert [result.id for result in execution.results] == ["segment_1"]
    assert reranker.calls == []


def test_unified_search_can_include_summary_results_when_requested() -> None:
    query_vector = build_placeholder_vector(
        "memory advantage",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        {
            "summary": [
                build_unified_row(
                    row_id="summary_1",
                    unit_type="summary",
                    score=0.99,
                    embedding=query_vector,
                    timestamp_start=None,
                    timestamp_end=None,
                )
            ],
            "speech": [
                build_unified_row(
                    row_id="segment_1",
                    unit_type="speech",
                    score=0.87,
                    embedding=query_vector,
                )
            ],
        }
    )
    service = UnifiedSearchService(
        database,
        embedding_backend=FakeEmbeddingBackend(query_vector),
        reranker=StaticReranker(),
    )

    execution = asyncio.run(
        service.search(
            SearchRequest.model_validate(
                {
                    "query": "memory advantage",
                    "max_results": 1,
                    "include_summary": True,
                }
            ),
            user_id="user_stub",
            request_id="req_123",
        )
    )

    assert [result.id for result in execution.results] == ["summary_1"]
    assert execution.results[0].timestamp_start is None


def test_unified_search_visual_snippet_prefers_scene_description_over_ocr() -> None:
    query_vector = build_placeholder_vector(
        "fireplace interview",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        {
            "visual": [
                build_unified_row(
                    row_id="visual_1",
                    unit_type="visual",
                    score=0.91,
                    embedding=query_vector,
                    visual_summary="A man and a woman sit in a room with a fireplace.",
                )
            ]
        }
    )
    service = UnifiedSearchService(
        database,
        embedding_backend=FakeEmbeddingBackend(query_vector),
        reranker=StaticReranker(),
    )

    execution = asyncio.run(
        service.search(
            SearchRequest.model_validate(
                {
                    "query": "fireplace interview",
                    "max_results": 1,
                }
            ),
            user_id="user_stub",
            request_id="req_123",
        )
    )

    assert execution.results[0].unit_type == "visual"
    assert execution.results[0].snippet == "A man and a woman sit in a room with a fireplace."


def test_unified_search_rerank_mode_keeps_embedding_score_and_exposes_rerank_score() -> None:
    query_vector = build_placeholder_vector(
        "agent workflows",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        {
            "speech": [
                build_unified_row(
                    row_id="segment_1",
                    unit_type="speech",
                    score=0.72,
                    embedding=query_vector,
                ),
                build_unified_row(
                    row_id="segment_2",
                    unit_type="speech",
                    score=0.61,
                    embedding=query_vector,
                ),
            ]
        }
    )
    service = UnifiedSearchService(
        database,
        embedding_backend=FakeEmbeddingBackend(query_vector),
        reranker=ReorderingReranker(["segment_2", "segment_1"]),
    )

    execution = asyncio.run(
        service.search(
            SearchRequest.model_validate(
                {
                    "query": "agent workflows",
                    "max_results": 2,
                    "ranking_mode": "rerank",
                }
            ),
            user_id="user_stub",
            request_id="req_123",
        )
    )

    assert [result.id for result in execution.results] == ["segment_2", "segment_1"]
    assert execution.results[0].score == pytest.approx(0.61)
    assert execution.results[0].rerank_score == pytest.approx(1.0)
    assert execution.results[1].score == pytest.approx(0.72)
    assert execution.results[1].rerank_score == pytest.approx(0.9)


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
        build_unified_row(row_id="segment_1", score=0.90, embedding=embedding),
        build_unified_row(row_id="segment_2", score=0.80, embedding=embedding),
        build_unified_row(row_id="segment_3", score=0.70, embedding=embedding),
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


def test_build_default_backend_uses_configured_openai_model() -> None:
    settings = SimpleNamespace(
        knowledge=SimpleNamespace(
            rerank_model="gpt-4.1-mini",
        )
    )

    backend = _build_default_backend(settings)

    assert isinstance(backend, OpenAICompatibleRerankerBackend)
    assert backend.model_name == "gpt-4.1-mini"


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
        build_unified_row(
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


def test_build_answer_prompt_includes_scene_before_onscreen_text() -> None:
    prompt = build_answer_prompt(
        query="fireplace interview",
        segments=[
            build_unified_row(
                row_id="segment_1",
                score=0.88,
                embedding=build_placeholder_vector(
                    "answer prompt visual evidence",
                    DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
                ),
                visual_summary="A man and a woman sit in a room with a fireplace.",
            )
        ],
    )

    assert "Visual evidence:" in prompt
    assert "Scene: A man and a woman sit in a room with a fireplace." in prompt
    assert "On-screen text: Agent workflows" in prompt
    assert prompt.index("Scene: A man and a woman sit in a room with a fireplace.") < prompt.index(
        "On-screen text: Agent workflows"
    )


def test_unified_search_includes_answer_when_include_answer_true() -> None:
    embedding = build_placeholder_vector(
        "knowledge search include answer",
        DEFAULT_KNOWLEDGE_VECTOR_DIMENSION,
    )
    database = FakeDatabase(
        {
            "speech": [build_unified_row(row_id="segment_1", score=0.88, embedding=embedding)]
        }
    )
    answer_text = (
        "Reasoning models help agents plan tasks more reliably "
        "[OpenAI Dev Day Keynote, 2:00-2:58]."
    )
    answer_generator = RecordingAnswerGenerator(answer=answer_text)
    service = UnifiedSearchService(
        database,
        embedding_backend=FakeEmbeddingBackend(embedding),
        reranker=StaticReranker(),
        answer_generator=answer_generator,
    )
    request = SearchRequest.model_validate(
        {
            "query": "agent workflows",
            "max_results": 1,
            "include_answer": True,
        }
    )

    execution = asyncio.run(
        service.search(
            request,
            user_id="user_stub",
            request_id="req_123",
        )
    )

    assert len(execution.results) == 1
    assert execution.answer == answer_text
    assert answer_generator.calls == [("agent workflows", ["segment_1"])]
