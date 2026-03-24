from __future__ import annotations

import base64
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import httpx


DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSION = 2048
DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL = "default"


class OpenAICompatibleEmbeddingBackend:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        model: str | None = None,
        output_dimension: int | None = None,
    ) -> None:
        resolved_base_url = (
            base_url or os.getenv("EMBEDDING_OPENAI_BASE_URL", "").strip()
        ).rstrip("/")
        if not resolved_base_url:
            raise ValueError(
                "EMBEDDING_OPENAI_BASE_URL is required for openai_compatible backend."
            )

        self._base_url = resolved_base_url
        self._api_key = (
            api_key
            or os.getenv("EMBEDDING_OPENAI_API_KEY", "").strip()
            or "no-key"
        )
        self._model = (
            model
            or os.getenv("EMBEDDING_OPENAI_MODEL", "").strip()
            or DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL
        )
        self._output_dimension = int(
            output_dimension
            or os.getenv(
                "EMBEDDING_DIMENSION",
                str(DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSION),
            )
        )

    @property
    def name(self) -> str:
        return f"openai_compatible:{self._model}"

    def dimension(self) -> int:
        return self._output_dimension

    def embed_text(self, text: str) -> list[float]:
        return self._embed(text=text)

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text=text)

    def embed_multimodal(
        self,
        text: str,
        *,
        image_paths: Sequence[str | Path] | None = None,
    ) -> list[float]:
        return self._embed(text=text, image_paths=image_paths)

    def embed_query_with_image(
        self,
        text: str | None = None,
        *,
        image_path: str | Path | None = None,
    ) -> list[float]:
        paths = [image_path] if image_path is not None else None
        return self._embed(text=text, image_paths=paths)

    def embed_image(self, image_path: str | Path) -> list[float]:
        return self._embed(image_paths=[image_path])

    def embed_video(self, video_path: str | Path) -> list[float]:
        raise NotImplementedError(
            "OpenAI-compatible embedding backend does not support video embeddings."
        )

    def _embed(
        self,
        *,
        text: str | None = None,
        image_paths: Sequence[str | Path | None] | None = None,
    ) -> list[float]:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        if image_paths and any(image_paths):
            input_parts: list[dict[str, Any]] = []
            if text is not None and text.strip():
                input_parts.append({"type": "text", "text": text.strip()})
            for raw_path in image_paths:
                if raw_path is None:
                    continue
                resolved_path = Path(raw_path)
                if not resolved_path.exists():
                    continue
                encoded = base64.b64encode(resolved_path.read_bytes()).decode("utf-8")
                mime_type = self._guess_mime(resolved_path)
                input_parts.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{encoded}"},
                    }
                )
            if not input_parts:
                raise ValueError("No valid input provided.")
            embedding_input: Any = input_parts
        else:
            embedding_input = (text or "").strip()
            if not embedding_input:
                raise ValueError("text must not be empty.")

        payload: dict[str, Any] = {
            "model": self._model,
            "input": embedding_input,
        }
        if self._output_dimension:
            payload["dimensions"] = self._output_dimension

        proxy = os.getenv("HTTPS_PROXY") or os.getenv("HTTP_PROXY") or None
        with httpx.Client(timeout=60.0, proxy=proxy) as client:
            response = client.post(
                f"{self._base_url}/embeddings",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()

        data = response.json()
        embedding = data["data"][0]["embedding"]
        vector = [float(value) for value in embedding]
        if self._output_dimension and len(vector) != self._output_dimension:
            raise ValueError(
                "OpenAI-compatible embedding dimension mismatch: "
                f"expected {self._output_dimension}, got {len(vector)}."
            )
        return vector

    @staticmethod
    def _guess_mime(path: Path) -> str:
        return {
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".png": "image/png",
            ".webp": "image/webp",
        }.get(path.suffix.lower(), "image/jpeg")
