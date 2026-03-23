from __future__ import annotations

import asyncio

from workers.common.pipeline import PipelineContext, PipelineStep, emit_step_log
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

        prepare_scene_analysis = getattr(frame_analyzer, "prepare_scene_analysis", None)
        annotate_prepared_scene = getattr(frame_analyzer, "annotate_prepared_scene", None)
        finalize_prepared_scene_analysis = getattr(
            frame_analyzer,
            "finalize_prepared_scene_analysis",
            None,
        )
        total_scenes = len(scenes)
        context.data["frame_analysis_scene_total"] = total_scenes
        total_candidate_frames = 0
        total_unique_frames = 0
        total_selected_frames = 0
        total_annotated_frames = 0
        total_extraction_cache_hits = 0
        total_annotation_cache_hits = 0
        total_extraction_time_ms = 0
        total_dedup_time_ms = 0
        total_filter_time_ms = 0
        total_ocr_time_ms = 0
        total_prepare_time_ms = 0
        total_annotation_time_ms = 0
        route_counts = {"text_only": 0, "embed_only": 0, "annotate": 0}
        analyses: list[dict[str, object]] = []

        def remember_analysis(analysis: dict[str, object]) -> tuple[int, int]:
            nonlocal total_candidate_frames
            nonlocal total_unique_frames
            nonlocal total_selected_frames
            nonlocal total_annotated_frames
            nonlocal total_extraction_cache_hits
            nonlocal total_annotation_cache_hits
            nonlocal total_extraction_time_ms
            nonlocal total_dedup_time_ms
            nonlocal total_filter_time_ms
            nonlocal total_ocr_time_ms
            nonlocal total_prepare_time_ms
            nonlocal total_annotation_time_ms

            analyses.append(dict(analysis))
            context.data["scene_analyses"] = analyses
            candidate_frame_count = int(analysis.get("candidate_frame_count", 0) or 0)
            unique_frame_count = int(
                analysis.get(
                    "unique_frame_count",
                    analysis.get("candidate_frame_count", 0),
                )
                or 0
            )
            selected_frame_count = int(analysis.get("informative_frame_count", 0) or 0)
            annotated_frame_count = int(analysis.get("annotation_frame_count", 0) or 0)
            extraction_cache_hit_count = int(
                analysis.get("extraction_cache_hit_count", 0) or 0
            )
            annotation_cache_hit_count = int(
                analysis.get("annotation_cache_hit_count", 0) or 0
            )
            extraction_time_ms = int(analysis.get("extraction_time_ms", 0) or 0)
            dedup_time_ms = int(analysis.get("dedup_time_ms", 0) or 0)
            filter_time_ms = int(analysis.get("filter_time_ms", 0) or 0)
            ocr_time_ms = int(analysis.get("ocr_time_ms", 0) or 0)
            prepare_time_ms = int(analysis.get("prepare_time_ms", 0) or 0)
            annotation_time_ms = int(analysis.get("annotation_time_ms", 0) or 0)
            analysis_route = str(analysis.get("analysis_route") or "text_only")

            total_candidate_frames += candidate_frame_count
            total_unique_frames += unique_frame_count
            total_selected_frames += selected_frame_count
            total_annotated_frames += annotated_frame_count
            total_extraction_cache_hits += extraction_cache_hit_count
            total_annotation_cache_hits += annotation_cache_hit_count
            total_extraction_time_ms += extraction_time_ms
            total_dedup_time_ms += dedup_time_ms
            total_filter_time_ms += filter_time_ms
            total_ocr_time_ms += ocr_time_ms
            total_prepare_time_ms += prepare_time_ms
            total_annotation_time_ms += annotation_time_ms
            route_counts[analysis_route] = route_counts.get(analysis_route, 0) + 1

            context.data["frame_analysis_candidate_frame_count"] = candidate_frame_count
            context.data["frame_analysis_unique_frame_count"] = unique_frame_count
            context.data["frame_analysis_selected_frame_count"] = selected_frame_count
            context.data["frame_analysis_annotation_frame_count"] = annotated_frame_count
            context.data["frame_analysis_extraction_cache_hit_count"] = extraction_cache_hit_count
            context.data["frame_analysis_annotation_cache_hit_count"] = annotation_cache_hit_count
            context.data["frame_analysis_extraction_time_ms"] = extraction_time_ms
            context.data["frame_analysis_dedup_time_ms"] = dedup_time_ms
            context.data["frame_analysis_filter_time_ms"] = filter_time_ms
            context.data["frame_analysis_ocr_time_ms"] = ocr_time_ms
            context.data["frame_analysis_prepare_time_ms"] = prepare_time_ms
            context.data["frame_analysis_annotation_time_ms"] = annotation_time_ms
            context.data["frame_analysis_current_route"] = analysis_route
            context.data["frame_analysis_total_candidate_frame_count"] = total_candidate_frames
            context.data["frame_analysis_total_unique_frame_count"] = total_unique_frames
            context.data["frame_analysis_total_selected_frame_count"] = total_selected_frames
            context.data["frame_analysis_total_annotation_frame_count"] = total_annotated_frames
            context.data["frame_analysis_total_extraction_cache_hit_count"] = (
                total_extraction_cache_hits
            )
            context.data["frame_analysis_total_annotation_cache_hit_count"] = (
                total_annotation_cache_hits
            )
            context.data["frame_analysis_total_extraction_time_ms"] = total_extraction_time_ms
            context.data["frame_analysis_total_dedup_time_ms"] = total_dedup_time_ms
            context.data["frame_analysis_total_filter_time_ms"] = total_filter_time_ms
            context.data["frame_analysis_total_ocr_time_ms"] = total_ocr_time_ms
            context.data["frame_analysis_total_prepare_time_ms"] = total_prepare_time_ms
            context.data["frame_analysis_total_annotation_time_ms"] = total_annotation_time_ms
            context.data["frame_analysis_route_counts"] = dict(route_counts)
            context.data["frame_analysis_annotation_timeout_count"] = (
                context.data.get("frame_analysis_annotation_timeout_count", 0)
                + int(analysis.get("annotation_timeout_count", 0) or 0)
            )
            context.data["frame_analysis_annotation_error_count"] = (
                context.data.get("frame_analysis_annotation_error_count", 0)
                + int(analysis.get("annotation_error_count", 0) or 0)
            )
            return analysis_route, extraction_cache_hit_count, annotation_cache_hit_count

        if (
            callable(prepare_scene_analysis)
            and callable(annotate_prepared_scene)
            and callable(finalize_prepared_scene_analysis)
        ):
            prepare_semaphore = asyncio.Semaphore(
                max(int(getattr(frame_analyzer, "prepare_concurrency", 1) or 1), 1)
            )
            annotation_semaphore = asyncio.Semaphore(
                max(int(getattr(frame_analyzer, "annotation_concurrency", 1) or 1), 1)
            )
            async def prepare_scene_entry(
                position: int,
                scene: dict[str, object],
            ) -> dict[str, object]:
                context.data["frame_analysis_current_scene_index"] = int(scene["scene_index"])
                context.data["frame_analysis_current_scene_position"] = position
                await emit_step_log(
                    context,
                    self.step_name,
                    f"Analyzing scene {position}/{total_scenes}.",
                    details={
                        "scene_index": int(scene["scene_index"]),
                        "timestamp_start": float(scene["timestamp_start"]),
                        "timestamp_end": float(scene["timestamp_end"]),
                    },
                )

                async def scene_log(
                    message: str,
                    details: dict[str, object] | None = None,
                ) -> None:
                    await emit_step_log(
                        context,
                        self.step_name,
                        message,
                        details=details,
                    )

                async with prepare_semaphore:
                    prepared_scene = await prepare_scene_analysis(
                        video_path,
                        scene=scene,
                        transcript_segments=transcript_segments,
                        video_metadata=video_metadata,
                        log_event=scene_log,
                    )
                annotation_task = None
                if prepared_scene.get("annotation_frames"):
                    annotation_task = asyncio.create_task(
                        annotate_prepared_scene(
                            prepared_scene,
                            log_event=scene_log,
                            semaphore=annotation_semaphore,
                        )
                    )
                return {
                    "position": position,
                    "prepared_scene": prepared_scene,
                    "annotation_task": annotation_task,
                }

            prepared_entries = await asyncio.gather(
                *(
                    prepare_scene_entry(position, dict(scene))
                    for position, scene in enumerate(scenes, start=1)
                )
            )

            for prepared_entry in prepared_entries:
                position = int(prepared_entry["position"])
                prepared_scene = prepared_entry["prepared_scene"]
                annotation_task = prepared_entry["annotation_task"]
                annotation_outcome = (
                    await annotation_task if annotation_task is not None else None
                )
                analysis = finalize_prepared_scene_analysis(
                    prepared_scene,
                    annotation_outcome=annotation_outcome,
                )
                (
                    analysis_route,
                    extraction_cache_hit_count,
                    annotation_cache_hit_count,
                ) = remember_analysis(dict(analysis))
                await emit_step_log(
                    context,
                    self.step_name,
                    f"Finished scene {position}/{total_scenes}.",
                    details={
                        "analysis_route": analysis_route,
                        "candidate_frame_count": analysis.get("candidate_frame_count", 0),
                        "unique_frame_count": analysis.get("unique_frame_count", 0),
                        "selected_frame_count": analysis.get("informative_frame_count", 0),
                        "annotation_frame_count": analysis.get("annotation_frame_count", 0),
                        "extraction_cache_hit_count": extraction_cache_hit_count,
                        "annotation_cache_hit_count": annotation_cache_hit_count,
                        "annotation_timeout_count": analysis.get("annotation_timeout_count", 0),
                        "annotation_error_count": analysis.get("annotation_error_count", 0),
                        "extraction_time_ms": analysis.get("extraction_time_ms", 0),
                        "dedup_time_ms": analysis.get("dedup_time_ms", 0),
                        "filter_time_ms": analysis.get("filter_time_ms", 0),
                        "ocr_time_ms": analysis.get("ocr_time_ms", 0),
                        "prepare_time_ms": analysis.get("prepare_time_ms", 0),
                        "annotation_time_ms": analysis.get("annotation_time_ms", 0),
                    },
                )

            context.data["scene_analyses"] = analyses
            return

        for position, scene in enumerate(scenes, start=1):
            context.data["frame_analysis_current_scene_index"] = int(scene["scene_index"])
            context.data["frame_analysis_current_scene_position"] = position
            await emit_step_log(
                context,
                self.step_name,
                f"Analyzing scene {position}/{total_scenes}.",
                details={
                    "scene_index": int(scene["scene_index"]),
                    "timestamp_start": float(scene["timestamp_start"]),
                    "timestamp_end": float(scene["timestamp_end"]),
                },
            )

            async def scene_log(
                message: str,
                details: dict[str, object] | None = None,
            ) -> None:
                await emit_step_log(
                    context,
                    self.step_name,
                    message,
                    details=details,
                )

            analysis = await frame_analyzer.analyze_scene(
                video_path,
                scene=scene,
                transcript_segments=transcript_segments,
                video_metadata=video_metadata,
                log_event=scene_log,
            )
            (
                analysis_route,
                extraction_cache_hit_count,
                annotation_cache_hit_count,
            ) = remember_analysis(dict(analysis))
            await emit_step_log(
                context,
                self.step_name,
                f"Finished scene {position}/{total_scenes}.",
                details={
                    "analysis_route": analysis_route,
                    "candidate_frame_count": analysis.get("candidate_frame_count", 0),
                    "unique_frame_count": analysis.get("unique_frame_count", 0),
                    "selected_frame_count": analysis.get("informative_frame_count", 0),
                    "annotation_frame_count": analysis.get("annotation_frame_count", 0),
                    "extraction_cache_hit_count": extraction_cache_hit_count,
                    "annotation_cache_hit_count": annotation_cache_hit_count,
                    "annotation_timeout_count": analysis.get("annotation_timeout_count", 0),
                    "annotation_error_count": analysis.get("annotation_error_count", 0),
                    "extraction_time_ms": analysis.get("extraction_time_ms", 0),
                    "dedup_time_ms": analysis.get("dedup_time_ms", 0),
                    "filter_time_ms": analysis.get("filter_time_ms", 0),
                    "ocr_time_ms": analysis.get("ocr_time_ms", 0),
                    "prepare_time_ms": analysis.get("prepare_time_ms", 0),
                    "annotation_time_ms": analysis.get("annotation_time_ms", 0),
                },
            )

        context.data["scene_analyses"] = analyses
