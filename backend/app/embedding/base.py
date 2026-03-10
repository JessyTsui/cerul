from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class EmbeddingBackend(Protocol):
    name: str

    def dimension(self) -> int:
        ...

    def embed_text(self, text: str) -> list[float]:
        ...

    def embed_image(self, image_path: str | Path) -> list[float]:
        ...
