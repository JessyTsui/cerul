from __future__ import annotations

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.knowledge.runtime import extract_keywords, summarize_text


class SegmentKnowledgeTranscriptStep(PipelineStep):
    step_name = "SegmentKnowledgeTranscriptStep"

    async def _process(self, context: PipelineContext) -> None:
        video_metadata = context.data.get("video_metadata")
        transcript_segments = context.data.get("transcript_segments")
        scenes = context.data.get("scenes")
        scene_analyses = context.data.get("scene_analyses", [])
        if video_metadata is None or transcript_segments is None or scenes is None:
            raise RuntimeError(
                "Knowledge segmentation requires metadata, transcript_segments, and scenes."
            )

        analyses_by_scene = {
            int(analysis["scene_index"]): analysis for analysis in scene_analyses
        }
        segments: list[dict[str, object]] = []

        for segment_index, scene in enumerate(scenes):
            overlapping_segments = [
                transcript_segment
                for transcript_segment in transcript_segments
                if not (
                    float(transcript_segment["end"]) <= float(scene["timestamp_start"])
                    or float(scene["timestamp_end"]) <= float(transcript_segment["start"])
                )
            ]
            transcript_text = " ".join(
                str(item["text"]).strip() for item in overlapping_segments
            ).strip()
            if not transcript_text:
                transcript_text = str(scene.get("transcript_excerpt") or "").strip()
            if not transcript_text:
                continue

            analysis = analyses_by_scene.get(int(scene["scene_index"]), {})
            visual_summary = str(analysis.get("visual_summary") or "").strip() or None
            keywords = analysis.get("keywords") or extract_keywords(transcript_text, limit=4)
            title = self._build_segment_title(
                video_title=str(video_metadata["title"]),
                transcript_text=transcript_text,
            )
            description = self._build_segment_description(
                transcript_text=transcript_text,
                visual_summary=visual_summary,
            )
            segments.append(
                {
                    "segment_index": segment_index,
                    "title": title,
                    "description": description,
                    "transcript_text": transcript_text,
                    "visual_summary": visual_summary,
                    "timestamp_start": float(scene["timestamp_start"]),
                    "timestamp_end": float(scene["timestamp_end"]),
                    "metadata": {
                        "scene_index": int(scene["scene_index"]),
                        "keywords": list(keywords) if isinstance(keywords, list) else [],
                        "speaker": video_metadata.get("speaker"),
                        "transcript_segment_count": len(overlapping_segments),
                    },
                }
            )

        if not segments:
            raise ValueError("Knowledge segmentation produced no segments.")

        context.data["segments"] = segments
        context.data["segment_count"] = len(segments)

    def _build_segment_title(self, *, video_title: str, transcript_text: str) -> str:
        keywords = extract_keywords(transcript_text, limit=3)
        if not keywords:
            return video_title
        topic = " / ".join(keyword.replace("_", " ") for keyword in keywords)
        return f"{video_title}: {topic}"

    def _build_segment_description(
        self,
        *,
        transcript_text: str,
        visual_summary: str | None,
    ) -> str:
        transcript_summary = summarize_text(transcript_text, max_words=20)
        if not visual_summary:
            return transcript_summary
        return f"{visual_summary} Transcript: {transcript_summary}"
