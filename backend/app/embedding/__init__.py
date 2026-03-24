import os

try:
    from app.config import get_settings
except ImportError:  # pragma: no cover - worker-side import path
    from backend.app.config import get_settings

from .base import EmbeddingBackend
from .clip import ClipEmbeddingBackend
from .gemini import (
    DEFAULT_GEMINI_EMBEDDING_DIMENSION,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
    GeminiEmbeddingBackend,
)
from .openai_compatible import (
    DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSION,
    DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL,
    OpenAICompatibleEmbeddingBackend,
)


def create_embedding_backend(
    *,
    output_dimension: int | None = None,
) -> EmbeddingBackend:
    settings = get_settings()
    backend_type = (
        os.getenv("EMBEDDING_BACKEND", settings.embedding.backend).strip().lower()
        or "gemini"
    )

    env_dimension = os.getenv("EMBEDDING_DIMENSION", "").strip()
    if env_dimension:
        resolved_dimension = int(env_dimension)
    elif output_dimension is not None:
        resolved_dimension = int(output_dimension)
    elif settings.embedding.dimension:
        resolved_dimension = settings.embedding.dimension
    elif backend_type == "openai_compatible":
        resolved_dimension = DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSION
    else:
        resolved_dimension = DEFAULT_GEMINI_EMBEDDING_DIMENSION

    if backend_type == "openai_compatible":
        env_model = os.getenv("EMBEDDING_MODEL", "").strip()
        configured_model = str(settings.embedding.model or "").strip()
        resolved_model = env_model or (
            configured_model
            if configured_model
            and configured_model != DEFAULT_GEMINI_EMBEDDING_MODEL
            else None
        )
        return OpenAICompatibleEmbeddingBackend(
            model=resolved_model,
            output_dimension=resolved_dimension,
        )

    return GeminiEmbeddingBackend(
        model_name=settings.embedding.model,
        output_dimension=resolved_dimension,
        normalize=settings.embedding.normalize,
    )

__all__ = [
    "ClipEmbeddingBackend",
    "create_embedding_backend",
    "DEFAULT_GEMINI_EMBEDDING_DIMENSION",
    "DEFAULT_GEMINI_EMBEDDING_MODEL",
    "DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_DIMENSION",
    "DEFAULT_OPENAI_COMPATIBLE_EMBEDDING_MODEL",
    "EmbeddingBackend",
    "GeminiEmbeddingBackend",
    "OpenAICompatibleEmbeddingBackend",
]
