from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from workers.common.pipeline import PipelineContext, PipelineStep, emit_step_log
from workers.knowledge.runtime import (
    KnowledgeMetadataClient,
    normalize_video_metadata,
)


class FetchKnowledgeMetadataStep(PipelineStep):
    step_name = "FetchKnowledgeMetadataStep"

    def __init__(
        self,
        metadata_client: KnowledgeMetadataClient | None = None,
    ) -> None:
        self._metadata_client = metadata_client

    async def _process(self, context: PipelineContext) -> None:
        video_id = str(context.data.get("video_id") or "").strip()
        if not video_id:
            raise ValueError("Knowledge indexing requires a video_id.")

        raw_metadata = context.data.get("source_metadata")
        if raw_metadata is None:
            metadata_client = self._metadata_client or context.conf.get("metadata_client")
            if metadata_client is None:
                raise RuntimeError("A knowledge metadata client is required.")
            await emit_step_log(
                context,
                self.step_name,
                f"Fetching source metadata for video {video_id}.",
                details={"video_id": video_id},
            )
            raw_metadata = await metadata_client.get_video_metadata(video_id)
        else:
            await emit_step_log(
                context,
                self.step_name,
                "Using provided source metadata from the request payload.",
            )

        if not isinstance(raw_metadata, Mapping):
            raise TypeError("Knowledge metadata payload must be a mapping.")

        video_metadata = normalize_video_metadata(
            raw_metadata,
            requested_video_id=video_id,
        )
        context.data["video_metadata"] = video_metadata
        context.data["source_video_id"] = video_metadata["source_video_id"]
        await emit_step_log(
            context,
            self.step_name,
            f"Resolved metadata for '{video_metadata['title']}'.",
            details={
                "source": video_metadata["source"],
                "duration_seconds": video_metadata.get("duration_seconds"),
            },
        )
