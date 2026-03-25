from __future__ import annotations

import asyncio
import importlib.util
import json
import math
from pathlib import Path

import pytest


def _load_eval_search_module():
    module_path = Path(__file__).resolve().parents[2] / "scripts" / "eval_search.py"
    spec = importlib.util.spec_from_file_location("eval_search_test_module", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FakeConnection:
    def __init__(self) -> None:
        self.closed = False

    async def close(self) -> None:
        self.closed = True


class _StubEmbedder:
    def embed_query(self, text: str) -> str:
        return text


def test_ndcg_at_k_uses_all_relevant_videos_in_ideal_ranking() -> None:
    module = _load_eval_search_module()

    expected = 1.0 / (1.0 + (1.0 / math.log2(3)))
    assert module.ndcg_at_k(["video-a"], {"video-a", "video-b"}, 5) == pytest.approx(
        expected
    )


def test_run_eval_averages_only_evaluated_queries(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _load_eval_search_module()
    eval_dir = tmp_path / "eval"
    eval_dir.mkdir()
    benchmark_path = eval_dir / "search_benchmark.json"
    benchmark_path.write_text(
        json.dumps(
            {
                "version": "test",
                "queries": [
                    {"_section": "header"},
                    {
                        "id": "q1",
                        "query": "first query",
                        "difficulty": "easy",
                        "relevant_videos": ["video-1"],
                    },
                    {"_section": "middle"},
                    {
                        "id": "q2",
                        "query": "second query",
                        "difficulty": "hard",
                        "relevant_videos": ["video-2"],
                    },
                ],
            }
        )
    )

    connection = _FakeConnection()

    async def fake_get_connection() -> _FakeConnection:
        return connection

    async def fake_vector_search(
        conn: _FakeConnection,
        query_embedding: str,
        *,
        limit: int = 20,
    ) -> list[dict[str, object]]:
        del conn, limit
        if query_embedding == "first query":
            return [{"source_video_id": "video-1", "title": "Match", "score": 0.9}]
        return [{"source_video_id": "other-video", "title": "Miss", "score": 0.9}]

    monkeypatch.setattr(module, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(module, "BENCHMARK_PATH", benchmark_path)
    monkeypatch.setattr(module, "get_connection", fake_get_connection)
    monkeypatch.setattr(
        module,
        "create_embedding_backend",
        lambda output_dimension: _StubEmbedder(),
    )
    monkeypatch.setattr(module, "vector_search", fake_vector_search)

    result = asyncio.run(module.run_eval("embedding", 1))

    assert result["evaluated_queries"] == 2
    assert result["hit3"] == pytest.approx(0.5)
    assert connection.closed is True

    details = json.loads((eval_dir / "search_eval_details.json").read_text())
    assert len(details["queries"]) == 2


def test_run_eval_honors_rerank_mode(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _load_eval_search_module()
    eval_dir = tmp_path / "eval"
    eval_dir.mkdir()
    benchmark_path = eval_dir / "search_benchmark.json"
    benchmark_path.write_text(
        json.dumps(
            {
                "version": "test",
                "queries": [
                    {
                        "id": "q1",
                        "query": "shopping memory",
                        "difficulty": "medium",
                        "relevant_videos": ["video-2"],
                    }
                ],
            }
        )
    )

    connection = _FakeConnection()
    rerank_calls: list[tuple[str, int | None]] = []

    async def fake_get_connection() -> _FakeConnection:
        return connection

    async def fake_vector_search(
        conn: _FakeConnection,
        query_embedding: str,
        *,
        limit: int = 20,
    ) -> list[dict[str, object]]:
        del conn, query_embedding, limit
        return [
            {"source_video_id": "video-1", "title": "Vector first", "score": 0.95},
            {"source_video_id": "video-2", "title": "Should win after rerank", "score": 0.90},
        ]

    class _StubReranker:
        async def rerank(
            self,
            query: str,
            candidates: list[dict[str, object]],
            top_n: int | None = None,
        ) -> list[dict[str, object]]:
            rerank_calls.append((query, top_n))
            first = dict(candidates[0])
            second = dict(candidates[1])
            first["rerank_score"] = 0.05
            second["rerank_score"] = 0.99
            return [second, first]

    monkeypatch.setattr(module, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(module, "BENCHMARK_PATH", benchmark_path)
    monkeypatch.setattr(module, "get_connection", fake_get_connection)
    monkeypatch.setattr(
        module,
        "create_embedding_backend",
        lambda output_dimension: _StubEmbedder(),
    )
    monkeypatch.setattr(module, "vector_search", fake_vector_search)
    monkeypatch.setattr(module, "LLMReranker", _StubReranker)

    result = asyncio.run(module.run_eval("rerank", 1))

    assert rerank_calls == [("shopping memory", 2)]
    assert result["hit3"] == pytest.approx(1.0)
    assert connection.closed is True
