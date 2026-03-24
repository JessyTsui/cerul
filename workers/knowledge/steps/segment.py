from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.knowledge.runtime import extract_keywords, summarize_text

DEFAULT_SEGMENT_TARGET_DURATION_SECONDS = 60.0
DEFAULT_SEGMENT_MIN_DURATION_SECONDS = 25.0
DEFAULT_SEGMENT_MAX_DURATION_SECONDS = 90.0
DEFAULT_SEGMENT_MAX_WORDS = 220


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
        segments = self._build_segments(
            video_metadata=video_metadata,
            transcript_segments=transcript_segments,
            scenes=scenes,
            analyses_by_scene=analyses_by_scene,
            conf=context.conf,
        )

        if not segments:
            raise ValueError("Knowledge segmentation produced no segments.")

        context.data["segments"] = segments
        context.data["segment_count"] = len(segments)

    def _build_segments(
        self,
        *,
        video_metadata: Mapping[str, Any],
        transcript_segments: Sequence[Mapping[str, Any]],
        scenes: Sequence[Mapping[str, Any]],
        analyses_by_scene: Mapping[int, Mapping[str, Any]],
        conf: Mapping[str, Any],
    ) -> list[dict[str, object]]:
        normalized_transcript_segments = self._normalize_transcript_segments(transcript_segments)
        if not normalized_transcript_segments:
            return self._build_scene_segments(
                video_metadata=video_metadata,
                scenes=scenes,
                analyses_by_scene=analyses_by_scene,
            )

        target_duration = max(
            float(conf.get("segment_target_duration_seconds") or DEFAULT_SEGMENT_TARGET_DURATION_SECONDS),
            10.0,
        )
        min_duration = max(
            min(
                float(conf.get("segment_min_duration_seconds") or DEFAULT_SEGMENT_MIN_DURATION_SECONDS),
                target_duration,
            ),
            5.0,
        )
        max_duration = max(
            float(conf.get("segment_max_duration_seconds") or DEFAULT_SEGMENT_MAX_DURATION_SECONDS),
            target_duration,
        )
        max_words = max(int(conf.get("segment_max_words") or DEFAULT_SEGMENT_MAX_WORDS), 40)
        transcript_windows = self._build_transcript_windows(
            normalized_transcript_segments,
            target_duration=target_duration,
            min_duration=min_duration,
            max_duration=max_duration,
            max_words=max_words,
        )

        segments: list[dict[str, object]] = []
        for segment_index, transcript_window in enumerate(transcript_windows):
            transcript_text = " ".join(item["text"] for item in transcript_window).strip()
            if not transcript_text:
                continue
            timestamp_start = float(transcript_window[0]["start"])
            timestamp_end = float(transcript_window[-1]["end"])
            scene, overlap_seconds = self._resolve_primary_scene(
                scenes,
                start=timestamp_start,
                end=timestamp_end,
            )
            analysis: Mapping[str, Any] = {}
            scene_index: int | None = None
            if scene is not None:
                scene_index = int(scene["scene_index"])
                analysis = analyses_by_scene.get(scene_index, {})
            segments.append(
                self._build_segment_payload(
                    segment_index=segment_index,
                    video_metadata=video_metadata,
                    analysis=analysis,
                    transcript_text=transcript_text,
                    timestamp_start=timestamp_start,
                    timestamp_end=timestamp_end,
                    transcript_segment_count=len(transcript_window),
                    scene_index=scene_index,
                    scene_overlap_seconds=overlap_seconds,
                )
            )
        return segments

    def _build_scene_segments(
        self,
        *,
        video_metadata: Mapping[str, Any],
        scenes: Sequence[Mapping[str, Any]],
        analyses_by_scene: Mapping[int, Mapping[str, Any]],
    ) -> list[dict[str, object]]:
        segments: list[dict[str, object]] = []
        for segment_index, scene in enumerate(scenes):
            transcript_text = str(scene.get("transcript_excerpt") or "").strip()
            if not transcript_text:
                continue
            scene_index = int(scene["scene_index"])
            segments.append(
                self._build_segment_payload(
                    segment_index=segment_index,
                    video_metadata=video_metadata,
                    analysis=analyses_by_scene.get(scene_index, {}),
                    transcript_text=transcript_text,
                    timestamp_start=float(scene["timestamp_start"]),
                    timestamp_end=float(scene["timestamp_end"]),
                    transcript_segment_count=0,
                    scene_index=scene_index,
                    scene_overlap_seconds=float(scene["timestamp_end"]) - float(scene["timestamp_start"]),
                )
            )
        return segments

    def _build_segment_payload(
        self,
        *,
        segment_index: int,
        video_metadata: Mapping[str, Any],
        analysis: Mapping[str, Any],
        transcript_text: str,
        timestamp_start: float,
        timestamp_end: float,
        transcript_segment_count: int,
        scene_index: int | None,
        scene_overlap_seconds: float,
    ) -> dict[str, object]:
        visual_summary = str(analysis.get("visual_summary") or "").strip() or None
        visual_description = str(analysis.get("visual_description") or "").strip() or None
        visual_text_content = str(analysis.get("visual_text_content") or "").strip() or None
        visual_type = str(analysis.get("visual_type") or "").strip() or None
        raw_visual_entities = analysis.get("visual_entities") or []
        visual_entities = [
            str(entity).strip()
            for entity in raw_visual_entities
            if str(entity).strip()
        ]
        frame_paths = [
            str(frame_path).strip()
            for frame_path in (analysis.get("frame_paths") or [])
            if str(frame_path).strip()
        ]
        keywords = analysis.get("keywords") or extract_keywords(transcript_text, limit=4)
        title = self._build_segment_title(
            video_title=str(video_metadata["title"]),
            transcript_text=transcript_text,
        )
        description = self._build_segment_description(
            transcript_text=transcript_text,
            visual_summary=visual_description or visual_summary,
        )
        metadata = {
            "keywords": list(keywords) if isinstance(keywords, list) else [],
            "speaker": video_metadata.get("speaker"),
            "transcript_segment_count": transcript_segment_count,
            "candidate_frame_count": int(analysis.get("candidate_frame_count") or 0),
            "informative_frame_count": int(analysis.get("informative_frame_count") or 0),
            "annotation_frame_count": int(analysis.get("annotation_frame_count") or 0),
            "analysis_route": str(analysis.get("analysis_route") or "text_only"),
            "ocr_detected": bool(analysis.get("ocr_detected")),
            "scene_overlap_seconds": round(max(scene_overlap_seconds, 0.0), 3),
        }
        if scene_index is not None:
            metadata["scene_index"] = scene_index
        return {
            "segment_index": segment_index,
            "title": title,
            "description": description,
            "transcript_text": transcript_text,
            "visual_summary": visual_summary,
            "has_visual_embedding": bool(analysis.get("has_visual_embedding")),
            "visual_type": visual_type,
            "visual_description": visual_description,
            "visual_text_content": visual_text_content,
            "visual_entities": visual_entities,
            "frame_paths": frame_paths,
            "timestamp_start": timestamp_start,
            "timestamp_end": timestamp_end,
            "metadata": metadata,
        }

    def _normalize_transcript_segments(
        self,
        transcript_segments: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, object]]:
        normalized_segments: list[dict[str, object]] = []
        for transcript_segment in transcript_segments:
            text = str(transcript_segment.get("text") or "").strip()
            if not text:
                continue
            start = float(
                transcript_segment.get("start")
                or transcript_segment.get("timestamp_start")
                or 0.0
            )
            end = float(
                transcript_segment.get("end")
                or transcript_segment.get("timestamp_end")
                or start
            )
            if end <= start:
                continue
            normalized_segments.append(
                {
                    "start": start,
                    "end": end,
                    "text": text,
                }
            )
        normalized_segments.sort(key=lambda segment: (float(segment["start"]), float(segment["end"])))
        return normalized_segments

    def _build_transcript_windows(
        self,
        transcript_segments: Sequence[Mapping[str, object]],
        *,
        target_duration: float,
        min_duration: float,
        max_duration: float,
        max_words: int,
    ) -> list[list[dict[str, object]]]:
        windows: list[list[dict[str, object]]] = []
        current_window: list[dict[str, object]] = []
        current_word_count = 0

        for transcript_segment in transcript_segments:
            segment_word_count = len(str(transcript_segment["text"]).split())
            if not current_window:
                current_window = [dict(transcript_segment)]
                current_word_count = segment_word_count
                continue

            current_duration = float(current_window[-1]["end"]) - float(current_window[0]["start"])
            proposed_duration = float(transcript_segment["end"]) - float(current_window[0]["start"])
            proposed_word_count = current_word_count + segment_word_count
            if (
                current_duration >= target_duration
                or proposed_duration > max_duration
                or proposed_word_count > max_words
            ):
                windows.append(current_window)
                current_window = [dict(transcript_segment)]
                current_word_count = segment_word_count
                continue

            current_window.append(dict(transcript_segment))
            current_word_count = proposed_word_count

        if current_window:
            windows.append(current_window)

        if len(windows) >= 2:
            last_window = windows[-1]
            last_duration = float(last_window[-1]["end"]) - float(last_window[0]["start"])
            if last_duration < min_duration:
                windows[-2].extend(last_window)
                windows.pop()

        return windows

    def _resolve_primary_scene(
        self,
        scenes: Sequence[Mapping[str, Any]],
        *,
        start: float,
        end: float,
    ) -> tuple[Mapping[str, Any] | None, float]:
        best_scene: Mapping[str, Any] | None = None
        best_overlap = 0.0
        for scene in scenes:
            scene_start = float(scene["timestamp_start"])
            scene_end = float(scene["timestamp_end"])
            overlap = min(end, scene_end) - max(start, scene_start)
            if overlap > best_overlap:
                best_scene = scene
                best_overlap = overlap
        if best_scene is not None:
            return best_scene, best_overlap
        if not scenes:
            return None, 0.0
        midpoint = (start + end) / 2.0
        nearest_scene = min(
            scenes,
            key=lambda scene: abs(
                ((float(scene["timestamp_start"]) + float(scene["timestamp_end"])) / 2.0)
                - midpoint
            ),
        )
        return nearest_scene, 0.0

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
