from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class EmbeddingBackend(Protocol):
    name: str

    def dimension(self) -> int:
        ...

    def embed_text(self, text: str) -> list[float]:
        """Embed a document/passage for indexing (RETRIEVAL_DOCUMENT semantics)."""
        ...

    def embed_query(self, text: str) -> list[float]:
        """Embed a search query (RETRIEVAL_QUERY semantics).

        Defaults to embed_text() for backends that do not distinguish task types.
        """
        return self.embed_text(text)

    def embed_image(self, image_path: str | Path) -> list[float]:
        ...

    def embed_video(self, video_path: str | Path) -> list[float]:
        ...
