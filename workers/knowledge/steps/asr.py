from __future__ import annotations

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.knowledge.runtime import (
    KnowledgeTranscriber,
    normalize_transcript_segments,
)


class TranscribeKnowledgeVideoStep(PipelineStep):
    step_name = "TranscribeKnowledgeVideoStep"

    def __init__(
        self,
        transcriber: KnowledgeTranscriber | None = None,
    ) -> None:
        self._transcriber = transcriber

    async def _process(self, context: PipelineContext) -> None:
        video_path = context.data.get("video_path")
        video_metadata = context.data.get("video_metadata")
        if video_path is None or video_metadata is None:
            raise RuntimeError("Knowledge transcription requires video_path and metadata.")

        raw_segments = context.data.get("transcript_segments")
        used_transcriber = False
        if raw_segments is None:
            transcriber = self._transcriber or context.conf.get("transcriber")
            if transcriber is None:
                raise RuntimeError("A knowledge transcriber is required.")
            raw_segments = await transcriber.transcribe(
                video_path,
                video_metadata=video_metadata,
            )
            used_transcriber = True

        transcript_segments = normalize_transcript_segments(
            raw_segments,
            default_end=float(video_metadata.get("duration_seconds") or 0),
        )
        if not transcript_segments:
            raise ValueError("Knowledge transcription produced no transcript segments.")

        context.data["transcript_segments"] = transcript_segments
        if used_transcriber:
            context.data.setdefault("transcript_source", "asr")
        context.data["transcript_segment_count"] = len(transcript_segments)
        context.data["transcript_word_count"] = sum(
            len(str(segment["text"]).split()) for segment in transcript_segments
        )
