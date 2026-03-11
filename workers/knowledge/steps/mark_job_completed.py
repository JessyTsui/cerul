from __future__ import annotations

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.knowledge.repository import KnowledgeRepository


class MarkKnowledgeJobCompletedStep(PipelineStep):
    step_name = "MarkKnowledgeJobCompletedStep"

    def __init__(
        self,
        repository: KnowledgeRepository | None = None,
    ) -> None:
        self._repository = repository

    async def _process(self, context: PipelineContext) -> None:
        repository = self._repository or context.conf.get("repository")
        artifacts = {
            "source_video_id": context.data.get("source_video_id"),
            "scene_count": context.data.get("scene_count", 0),
            "segment_count": context.data.get("segment_count", 0),
            "indexed_segment_count": context.data.get("indexed_segment_count", 0),
            "transcript_segment_count": context.data.get("transcript_segment_count", 0),
            "embedding_error_count": len(context.data.get("embedding_errors", {})),
            "temp_dir": context.data.get("temp_dir"),
            "video_path": context.data.get("video_path"),
        }
        context.data["job_status"] = "completed"
        context.data["job_artifacts"] = artifacts

        if repository is not None:
            await repository.mark_job_completed(
                job_id=context.data.get("job_id"),
                artifacts=artifacts,
            )
