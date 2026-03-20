import base64
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.app.embedding import (
    DEFAULT_GEMINI_EMBEDDING_DIMENSION,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
    GeminiEmbeddingBackend,
)

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZxioAAAAASUVORK5CYII="
)


class FakeEmbedding:
    def __init__(self, values: list[float]) -> None:
        self.values = values


class RecordingModels:
    def __init__(self, values: list[float]) -> None:
        self._values = values
        self.calls: list[dict[str, object]] = []

    def embed_content(self, *, model: str, contents: object, config: object) -> object:
        self.calls.append(
            {
                "model": model,
                "contents": contents,
                "config": config,
            }
        )
        return type("Response", (), {"embeddings": [FakeEmbedding(self._values)]})()


class RecordingClient:
    def __init__(self, values: list[float]) -> None:
        self.models = RecordingModels(values)


def _write_png(path: Path) -> Path:
    path.write_bytes(PNG_1X1)
    return path


def test_gemini_embedding_backend_embeds_text_image_video_and_multimodal(
    tmp_path: Path,
) -> None:
    values = [float(index) for index in range(DEFAULT_GEMINI_EMBEDDING_DIMENSION)]
    client = RecordingClient(values)
    backend = GeminiEmbeddingBackend(client=client, normalize=False)
    image_path = _write_png(tmp_path / "frame.png")
    video_path = tmp_path / "clip.mp4"
    video_path.write_bytes(b"\x00\x00\x00\x18ftypmp42")

    with patch.object(backend, "_get_sdk_types", return_value=None):
        text_vector = backend.embed_text("cinematic drone shot")
        image_vector = backend.embed_image(image_path)
        video_vector = backend.embed_video(video_path)
        multimodal_vector = backend.embed_multimodal(
            "OpenAI Dev Day keynote",
            image_paths=[image_path],
        )

    assert text_vector == values
    assert image_vector == values
    assert video_vector == values
    assert multimodal_vector == values
    assert len(text_vector) == DEFAULT_GEMINI_EMBEDDING_DIMENSION
    assert len(image_vector) == DEFAULT_GEMINI_EMBEDDING_DIMENSION
    assert len(video_vector) == DEFAULT_GEMINI_EMBEDDING_DIMENSION
    assert len(multimodal_vector) == DEFAULT_GEMINI_EMBEDDING_DIMENSION
    assert client.models.calls[0]["model"] == DEFAULT_GEMINI_EMBEDDING_MODEL
    assert client.models.calls[1]["contents"][0]["mime_type"] == "image/png"
    assert client.models.calls[2]["contents"][0]["mime_type"] == "video/mp4"
    assert client.models.calls[3]["contents"][0] == "OpenAI Dev Day keynote"
    assert client.models.calls[3]["contents"][1]["mime_type"] == "image/png"
    assert client.models.calls[1]["config"] == {
        "output_dimensionality": DEFAULT_GEMINI_EMBEDDING_DIMENSION,
        "task_type": "RETRIEVAL_DOCUMENT",
    }


def test_gemini_embedding_backend_rejects_unexpected_dimensions() -> None:
    client = RecordingClient(
        [0.0] * (DEFAULT_GEMINI_EMBEDDING_DIMENSION - 1)
    )
    backend = GeminiEmbeddingBackend(client=client)

    with pytest.raises(ValueError, match="dimension mismatch"):
        backend.embed_text("cerul")


def test_gemini_embedding_backend_requires_api_key() -> None:
    with patch.dict(os.environ, {"GEMINI_API_KEY": ""}):
        backend = GeminiEmbeddingBackend(api_key="")

        with pytest.raises(RuntimeError, match="GEMINI_API_KEY is not set"):
            backend.embed_text("cerul")


def test_gemini_embedding_backend_real_api_returns_768_dimensions(
    tmp_path: Path,
) -> None:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        pytest.skip("GEMINI_API_KEY is not set.")

    pytest.importorskip("google.genai")

    image_path = _write_png(tmp_path / "frame.png")
    backend = GeminiEmbeddingBackend(api_key=api_key)
    text_vector = backend.embed_text("Cerul indexes video moments.")
    image_vector = backend.embed_image(image_path)

    assert len(text_vector) == DEFAULT_GEMINI_EMBEDDING_DIMENSION
    assert len(image_vector) == DEFAULT_GEMINI_EMBEDDING_DIMENSION
    assert all(isinstance(value, float) for value in text_vector)
    assert all(isinstance(value, float) for value in image_vector)
