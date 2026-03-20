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
            frame_paths = [
                str(frame_path).strip()
                for frame_path in (segment.get("frame_paths") or [])
                if str(frame_path).strip()
            ]
            try:
                embed_multimodal = getattr(embedding_backend, "embed_multimodal", None)
                if frame_paths and callable(embed_multimodal):
                    vector = list(
                        embed_multimodal(
                            payload,
                            image_paths=frame_paths,
                        )
                    )
                    segment["has_visual_embedding"] = True
                else:
                    vector = list(embedding_backend.embed_text(payload))
                    segment["has_visual_embedding"] = False
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
            str(segment.get("transcript_text") or "").strip(),
        ]
        visual_description = str(segment.get("visual_description") or "").strip()
        visual_text_content = str(segment.get("visual_text_content") or "").strip()
        visual_entities = [
            str(entity).strip()
            for entity in (segment.get("visual_entities") or [])
            if str(entity).strip()
        ]
        if visual_description:
            parts.append(f"[Visual content: {visual_description}]")
        if visual_text_content:
            parts.append(f"[Visible text: {visual_text_content}]")
        if visual_entities:
            parts.append(f"[Visual entities: {', '.join(visual_entities)}]")
        return "\n".join(part for part in parts if part)
