from __future__ import annotations

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.knowledge.runtime import KnowledgeSceneDetector


class DetectKnowledgeScenesStep(PipelineStep):
    step_name = "DetectKnowledgeScenesStep"

    def __init__(
        self,
        scene_detector: KnowledgeSceneDetector | None = None,
    ) -> None:
        self._scene_detector = scene_detector

    async def _process(self, context: PipelineContext) -> None:
        video_path = context.data.get("video_path")
        video_metadata = context.data.get("video_metadata")
        transcript_segments = context.data.get("transcript_segments")
        if video_path is None or video_metadata is None or transcript_segments is None:
            raise RuntimeError(
                "Scene detection requires video_path, video_metadata, and transcript_segments."
            )

        scene_detector = self._scene_detector or context.conf.get("scene_detector")
        if scene_detector is None:
            raise RuntimeError("A knowledge scene detector is required.")

        threshold = float(context.conf.get("scene_threshold", 0.35))
        scenes = await scene_detector.detect_scenes(
            video_path,
            transcript_segments=transcript_segments,
            video_metadata=video_metadata,
            threshold=threshold,
        )
        if not scenes:
            raise ValueError("Scene detection produced no scenes.")

        context.data["scenes"] = [dict(scene) for scene in scenes]
        context.data["scene_count"] = len(scenes)
