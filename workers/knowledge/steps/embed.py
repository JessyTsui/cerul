from __future__ import annotations

from backend.app.embedding import EmbeddingBackend
from workers.common.pipeline import PipelineContext, PipelineStep


class EmbedKnowledgeSegmentsStep(PipelineStep):
    step_name = "EmbedKnowledgeSegmentsStep"

    def __init__(
        self,
        embedding_backend: EmbeddingBackend | None = None,
    ) -> None:
        self._embedding_backend = embedding_backend

    async def _process(self, context: PipelineContext) -> None:
        segments = context.data.get("segments")
        if segments is None:
            raise RuntimeError("Knowledge embeddings require segmented transcript data.")

        embedding_backend = self._embedding_backend or context.conf.get(
            "embedding_backend"
        )
        if embedding_backend is None:
            raise RuntimeError("An embedding backend is required.")

        embeddings: dict[int, list[float]] = {}
        embedding_errors: dict[int, str] = {}

        for segment in segments:
            segment_index = int(segment["segment_index"])
            payload = self._build_embedding_payload(segment)
            try:
                vector = list(embedding_backend.embed_text(payload))
            except Exception as exc:
                embedding_errors[segment_index] = str(exc)
                continue

            if len(vector) != embedding_backend.dimension():
                raise ValueError(
                    f"Embedding dimension mismatch for segment {segment_index}: "
                    f"expected {embedding_backend.dimension()}, got {len(vector)}."
                )

            embeddings[segment_index] = vector

        if not embeddings:
            raise ValueError("Knowledge embedding produced no vectors.")

        context.data["segment_embeddings"] = embeddings
        context.data["embedding_dimension"] = embedding_backend.dimension()
        if embedding_errors:
            context.data["embedding_errors"] = embedding_errors

    def _build_embedding_payload(self, segment: dict[str, object]) -> str:
        parts = [
            str(segment.get("title") or "").strip(),
            str(segment.get("description") or "").strip(),
            str(segment.get("transcript_text") or "").strip(),
            str(segment.get("visual_summary") or "").strip(),
        ]
        return "\n".join(part for part in parts if part)
