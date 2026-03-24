from pathlib import Path
from typing import Any
import warnings

from .base import EmbeddingBackend


class ClipEmbeddingBackend(EmbeddingBackend):
    name = "openai-clip-vit-b-32"

    def __init__(
        self,
        model_name: str = "ViT-B-32",
        pretrained: str = "openai",
        device: str | None = None,
    ) -> None:
        warnings.warn(
            "ClipEmbeddingBackend is deprecated; use GeminiEmbeddingBackend instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        self._model_name = model_name
        self._pretrained = pretrained
        self._device_override = device
        self._device: str | None = None
        self._model: Any | None = None
        self._preprocess: Any | None = None
        self._tokenizer: Any | None = None
        self._torch: Any | None = None

    def dimension(self) -> int:
        return 512

    def embed_text(self, text: str) -> list[float]:
        self._ensure_model()
        assert self._tokenizer is not None
        assert self._torch is not None
        assert self._model is not None
        assert self._device is not None

        tokens = self._tokenizer([text]).to(self._device)
        with self._torch.no_grad():
            features = self._model.encode_text(tokens)
            features = features / features.norm(dim=-1, keepdim=True)

        return features[0].detach().cpu().tolist()

    def embed_query(self, text: str) -> list[float]:
        # CLIP does not distinguish task types; reuse embed_text.
        return self.embed_text(text)

    def embed_image(self, image_path: str | Path) -> list[float]:
        self._ensure_model()
        assert self._preprocess is not None
        assert self._torch is not None
        assert self._model is not None
        assert self._device is not None

        try:
            from PIL import Image
        except ImportError as exc:
            raise RuntimeError(
                "ClipEmbeddingBackend requires the optional Pillow dependency."
            ) from exc

        with Image.open(image_path) as image:
            image_tensor = self._preprocess(image.convert("RGB")).unsqueeze(0).to(
                self._device
            )

        with self._torch.no_grad():
            features = self._model.encode_image(image_tensor)
            features = features / features.norm(dim=-1, keepdim=True)

        return features[0].detach().cpu().tolist()

    def embed_video(self, video_path: str | Path) -> list[float]:
        raise NotImplementedError(
            "ClipEmbeddingBackend does not support video embeddings. "
            "Use GeminiEmbeddingBackend instead."
        )

    def _ensure_model(self) -> None:
        if self._model is not None:
            return

        try:
            import open_clip
            import torch
        except ImportError as exc:
            raise RuntimeError(
                "ClipEmbeddingBackend requires the optional open-clip-torch dependency."
            ) from exc

        device = self._device_override or (
            "cuda" if torch.cuda.is_available() else "cpu"
        )
        model, _, preprocess = open_clip.create_model_and_transforms(
            self._model_name,
            pretrained=self._pretrained,
            device=device,
        )
        tokenizer = open_clip.get_tokenizer(self._model_name)

        model.eval()
        self._device = device
        self._model = model
        self._preprocess = preprocess
        self._tokenizer = tokenizer
        self._torch = torch
