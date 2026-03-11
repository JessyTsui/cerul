from __future__ import annotations

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.knowledge.runtime import KnowledgeFrameAnalyzer


class AnalyzeKnowledgeFramesStep(PipelineStep):
    step_name = "AnalyzeKnowledgeFramesStep"

    def __init__(
        self,
        frame_analyzer: KnowledgeFrameAnalyzer | None = None,
    ) -> None:
        self._frame_analyzer = frame_analyzer

    async def _process(self, context: PipelineContext) -> None:
        video_path = context.data.get("video_path")
        video_metadata = context.data.get("video_metadata")
        transcript_segments = context.data.get("transcript_segments")
        scenes = context.data.get("scenes")
        if (
            video_path is None
            or video_metadata is None
            or transcript_segments is None
            or scenes is None
        ):
            raise RuntimeError(
                "Frame analysis requires video_path, metadata, transcript_segments, and scenes."
            )

        frame_analyzer = self._frame_analyzer or context.conf.get("frame_analyzer")
        if frame_analyzer is None:
            raise RuntimeError("A knowledge frame analyzer is required.")

        analyses: list[dict[str, object]] = []
        for scene in scenes:
            analysis = await frame_analyzer.analyze_scene(
                video_path,
                scene=scene,
                transcript_segments=transcript_segments,
                video_metadata=video_metadata,
            )
            analyses.append(dict(analysis))

        context.data["scene_analyses"] = analyses
