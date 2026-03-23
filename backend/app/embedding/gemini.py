from __future__ import annotations

import math
import mimetypes
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from .base import EmbeddingBackend

DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2-preview"
DEFAULT_GEMINI_EMBEDDING_DIMENSION = 768

# Task type constants — mirrors google.genai TaskType enum values accepted as strings.
TASK_RETRIEVAL_DOCUMENT = "RETRIEVAL_DOCUMENT"
TASK_RETRIEVAL_QUERY = "RETRIEVAL_QUERY"


class GeminiEmbeddingBackend(EmbeddingBackend):
    def __init__(
        self,
        *,
        api_key: str | None = None,
        model_name: str = DEFAULT_GEMINI_EMBEDDING_MODEL,
        output_dimension: int = DEFAULT_GEMINI_EMBEDDING_DIMENSION,
        normalize: bool = True,
        client: Any | None = None,
    ) -> None:
        self.name = model_name
        self._api_key = api_key or os.getenv("GEMINI_API_KEY", "").strip()
        self._model_name = model_name
        self._output_dimension = output_dimension
        # Google recommends L2-normalising embeddings when output_dimensionality != 3072
        # so that cosine-similarity comparisons are consistent.
        self._normalize = normalize and output_dimension != 3072
        self._client = client
        self._sdk_types: Any | None = None

    def dimension(self) -> int:
        return self._output_dimension

    def embed_text(self, text: str) -> list[float]:
        """Embed a document for indexing (RETRIEVAL_DOCUMENT task type)."""
        if not text.strip():
            raise ValueError("text must not be empty.")
        return self._embed_content(text, task_type=TASK_RETRIEVAL_DOCUMENT)

    def embed_query(self, text: str) -> list[float]:
        """Embed a search query (RETRIEVAL_QUERY task type)."""
        if not text.strip():
            raise ValueError("text must not be empty.")
        return self._embed_content(text, task_type=TASK_RETRIEVAL_QUERY)

    def embed_query_with_image(
        self,
        text: str | None = None,
        *,
        image_path: str | Path | None = None,
    ) -> list[float]:
        contents: list[Any] = []
        if text is not None and text.strip():
            contents.append(self._build_text_part(text.strip()))
        if image_path is not None:
            resolved_path = Path(image_path)
            if not resolved_path.exists():
                raise FileNotFoundError(f"{resolved_path} does not exist.")
            contents.append(
                self._build_media_part_from_path(
                    resolved_path,
                    expected_mime_prefix="image/",
                )
            )
        if not contents:
            raise ValueError("At least text or image_path must be provided.")
        return self._embed_content(contents, task_type=TASK_RETRIEVAL_QUERY)

    def embed_image(self, image_path: str | Path) -> list[float]:
        return self._embed_file(image_path, expected_mime_prefix="image/")

    def embed_video(self, video_path: str | Path) -> list[float]:
        return self._embed_file(video_path, expected_mime_prefix="video/")

    def embed_multimodal(
        self,
        text: str,
        *,
        image_paths: Sequence[str | Path] | None = None,
    ) -> list[float]:
        if not text.strip():
            raise ValueError("text must not be empty.")

        contents: list[Any] = [self._build_text_part(text)]
        for image_path in list(image_paths or [])[:6]:
            resolved_path = Path(image_path)
            if not resolved_path.exists():
                raise FileNotFoundError(f"{resolved_path} does not exist.")
            contents.append(
                self._build_media_part_from_path(
                    resolved_path,
                    expected_mime_prefix="image/",
                )
            )

        return self._embed_content(contents, task_type=TASK_RETRIEVAL_DOCUMENT)

    def _embed_file(
        self,
        file_path: str | Path,
        *,
        expected_mime_prefix: str,
    ) -> list[float]:
        resolved_path = Path(file_path)
        if not resolved_path.exists():
            raise FileNotFoundError(f"{resolved_path} does not exist.")

        mime_type, _ = mimetypes.guess_type(resolved_path.name)
        if mime_type is None:
            mime_type = "image/jpeg" if expected_mime_prefix == "image/" else "video/mp4"

        if not mime_type.startswith(expected_mime_prefix):
            kind = expected_mime_prefix.removesuffix("/")
            raise ValueError(f"{resolved_path} is not a {kind} file.")

        return self._embed_content(
            self._build_media_part_from_path(
                resolved_path,
                expected_mime_prefix=expected_mime_prefix,
            ),
            task_type=TASK_RETRIEVAL_DOCUMENT,
        )

    def _embed_content(self, content: Any, *, task_type: str | None = None) -> list[float]:
        client = self._get_client()
        if isinstance(content, str):
            contents: Any = content
        elif isinstance(content, Sequence) and not isinstance(content, (bytes, bytearray, str)):
            contents = list(content)
        else:
            contents = [content]
        response = client.models.embed_content(
            model=self._model_name,
            contents=contents,
            config=self._build_config(task_type=task_type),
        )
        vector = self._extract_vector(response)
        if self._normalize:
            vector = _l2_normalize(vector)
        return vector

    def _build_config(self, *, task_type: str | None = None) -> Any:
        sdk_types = self._get_sdk_types()
        kwargs: dict[str, Any] = {"output_dimensionality": self._output_dimension}
        if task_type:
            kwargs["task_type"] = task_type
        if sdk_types is None:
            return kwargs
        return sdk_types.EmbedContentConfig(**kwargs)

    def _build_media_part(self, *, data: bytes, mime_type: str) -> Any:
        sdk_types = self._get_sdk_types()
        if sdk_types is None:
            if self._client is None:
                raise RuntimeError(
                    "GeminiEmbeddingBackend requires google-genai. "
                    "Install workers/requirements.txt."
                )
            return {
                "data": data,
                "mime_type": mime_type,
            }
        return sdk_types.Part.from_bytes(
            data=data,
            mime_type=mime_type,
        )

    def _build_media_part_from_path(
        self,
        file_path: Path,
        *,
        expected_mime_prefix: str,
    ) -> Any:
        mime_type, _ = mimetypes.guess_type(file_path.name)
        if mime_type is None:
            mime_type = "image/jpeg" if expected_mime_prefix == "image/" else "video/mp4"

        if not mime_type.startswith(expected_mime_prefix):
            kind = expected_mime_prefix.removesuffix("/")
            raise ValueError(f"{file_path} is not a {kind} file.")

        return self._build_media_part(
            data=file_path.read_bytes(),
            mime_type=mime_type,
        )

    def _build_text_part(self, text: str) -> Any:
        sdk_types = self._get_sdk_types()
        if sdk_types is None:
            return text
        return sdk_types.Part.from_text(text=text)

    def _extract_vector(self, response: Any) -> list[float]:
        embeddings = getattr(response, "embeddings", None)
        if embeddings is None and isinstance(response, dict):
            embeddings = response.get("embeddings")

        if embeddings is None:
            embedding = getattr(response, "embedding", None)
            if embedding is None and isinstance(response, dict):
                embedding = response.get("embedding")
            if embedding is None:
                raise RuntimeError("Gemini embed_content returned no embeddings.")
            embeddings = [embedding]

        if not embeddings:
            raise RuntimeError("Gemini embed_content returned an empty embedding list.")

        first_embedding = embeddings[0]
        values = getattr(first_embedding, "values", None)
        if values is None and isinstance(first_embedding, dict):
            values = first_embedding.get("values")
        if values is None and isinstance(first_embedding, (list, tuple)):
            values = first_embedding
        if values is None:
            raise RuntimeError("Gemini embedding payload is missing values.")

        vector = [float(value) for value in values]
        if len(vector) != self._output_dimension:
            raise ValueError(
                "Gemini embedding dimension mismatch: "
                f"expected {self._output_dimension}, got {len(vector)}."
            )
        return vector

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client

        if not self._api_key:
            raise RuntimeError("GEMINI_API_KEY is not set.")

        genai_module = self._load_sdk()[0]
        self._client = genai_module.Client(api_key=self._api_key)
        return self._client

    def _get_sdk_types(self) -> Any | None:
        try:
            return self._load_sdk()[1]
        except RuntimeError:
            if self._client is not None:
                return None
            raise

    def _load_sdk(self) -> tuple[Any, Any]:
        if self._sdk_types is not None:
            from google import genai

            return genai, self._sdk_types

        try:
            from google import genai
            from google.genai import types
        except ImportError as exc:
            raise RuntimeError(
                "GeminiEmbeddingBackend requires google-genai. "
                "Install workers/requirements.txt."
            ) from exc

        self._sdk_types = types
        return genai, types


def _l2_normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0.0:
        return vector
    return [v / norm for v in vector]
