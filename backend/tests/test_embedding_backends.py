import base64
from pathlib import Path

import httpx
import pytest

from app.config import reset_settings_cache
from app.embedding import (
    GeminiEmbeddingBackend,
    OpenAICompatibleEmbeddingBackend,
    create_embedding_backend,
)

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZxioAAAAASUVORK5CYII="
)


@pytest.fixture(autouse=True)
def reset_embedding_settings_cache() -> None:
    reset_settings_cache()
    yield
    reset_settings_cache()


def _write_png(path: Path) -> Path:
    path.write_bytes(PNG_1X1)
    return path


def test_create_embedding_backend_default_is_gemini(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
    monkeypatch.delenv("EMBEDDING_OPENAI_BASE_URL", raising=False)

    backend = create_embedding_backend()

    assert isinstance(backend, GeminiEmbeddingBackend)
    assert "gemini" in backend.name.lower()


def test_create_embedding_backend_openai_compatible(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EMBEDDING_BACKEND", "openai_compatible")
    monkeypatch.setenv("EMBEDDING_OPENAI_BASE_URL", "http://localhost:9999/v1")

    backend = create_embedding_backend()

    assert isinstance(backend, OpenAICompatibleEmbeddingBackend)
    assert "openai_compatible" in backend.name


def test_create_embedding_backend_openai_compatible_uses_env_dimension(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EMBEDDING_BACKEND", "openai_compatible")
    monkeypatch.setenv("EMBEDDING_OPENAI_BASE_URL", "http://localhost:9999/v1")
    monkeypatch.setenv("EMBEDDING_DIMENSION", "2048")

    backend = create_embedding_backend(output_dimension=3072)

    assert backend.dimension() == 2048


def test_openai_compatible_embedding_backend_posts_multimodal_payload(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    image_path = _write_png(tmp_path / "query.png")
    captured: dict[str, object] = {}

    class StubResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"data": [{"embedding": [0.1, 0.2, 0.3]}]}

    class StubClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def __enter__(self) -> "StubClient":
            return self

        def __exit__(self, exc_type: object, exc: object, traceback: object) -> bool:
            return False

        def post(
            self,
            url: str,
            *,
            headers: dict[str, str],
            json: dict[str, object],
        ) -> StubResponse:
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return StubResponse()

    monkeypatch.setattr(httpx, "Client", StubClient)
    backend = OpenAICompatibleEmbeddingBackend(
        base_url="http://localhost:9999/v1",
        api_key="test-key",
        model="qwen3-vl-embedding-2b",
        output_dimension=3,
    )

    vector = backend.embed_query_with_image(
        "fireplace interview",
        image_path=image_path,
    )

    assert vector == [0.1, 0.2, 0.3]
    assert captured["url"] == "http://localhost:9999/v1/embeddings"
    assert captured["headers"] == {
        "Authorization": "Bearer test-key",
        "Content-Type": "application/json",
    }
    payload = captured["json"]
    assert payload["model"] == "qwen3-vl-embedding-2b"
    assert payload["dimensions"] == 3
    assert payload["input"][0] == {"type": "text", "text": "fireplace interview"}
    assert payload["input"][1]["type"] == "image_url"
    assert payload["input"][1]["image_url"]["url"].startswith("data:image/png;base64,")
