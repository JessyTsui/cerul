from __future__ import annotations

import tempfile
from pathlib import Path

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.knowledge.runtime import (
    KnowledgeCaptionProvider,
    load_transcript_segments_from_source,
    resolve_inline_transcript_segments,
    resolve_transcript_source,
)


def _append_caption_resolution_warning(context: PipelineContext, warning: str) -> None:
    cleaned_warning = warning.strip()
    if not cleaned_warning:
        return

    existing_warning = str(context.data.get("caption_resolution_warning") or "").strip()
    if not existing_warning:
        context.data["caption_resolution_warning"] = cleaned_warning
        return

    if cleaned_warning in existing_warning:
        return

    context.data["caption_resolution_warning"] = f"{existing_warning}; {cleaned_warning}"


class FetchKnowledgeCaptionsStep(PipelineStep):
    step_name = "FetchKnowledgeCaptionsStep"

    def __init__(
        self,
        caption_provider: KnowledgeCaptionProvider | None = None,
    ) -> None:
        self._caption_provider = caption_provider

    async def _process(self, context: PipelineContext) -> None:
        video_metadata = context.data.get("video_metadata")
        if video_metadata is None:
            raise RuntimeError("Knowledge metadata must be fetched before resolving captions.")

        if context.data.get("transcript_segments") is not None:
            return

        default_end = float(video_metadata.get("duration_seconds") or 0.0)
        inline_segments = resolve_inline_transcript_segments(
            video_metadata,
            default_end=default_end,
        )
        if inline_segments:
            context.data["transcript_segments"] = inline_segments
            context.data["transcript_source"] = "metadata:inline"
            return

        transcript_source = resolve_transcript_source(video_metadata)
        if transcript_source is not None:
            try:
                transcript_segments = await load_transcript_segments_from_source(
                    transcript_source,
                    default_end=default_end,
                )
            except Exception as exc:
                _append_caption_resolution_warning(
                    context,
                    f"Failed to load transcript source {transcript_source}: {exc}",
                )
            else:
                if transcript_segments:
                    context.data["transcript_segments"] = transcript_segments
                    context.data["transcript_source"] = str(transcript_source)
                    return
                _append_caption_resolution_warning(
                    context,
                    f"Transcript source {transcript_source} returned no usable segments.",
                )

        caption_provider = self._caption_provider or context.conf.get("caption_provider")
        if caption_provider is None:
            return

        temp_dir = context.data.get("temp_dir")
        if temp_dir is None:
            temp_dir_root = context.conf.get("temp_dir_root")
            temp_dir = tempfile.mkdtemp(prefix="cerul-knowledge-", dir=temp_dir_root or None)
            context.data["temp_dir"] = temp_dir

        try:
            transcript_segments = await caption_provider.resolve_transcript_segments(
                video_metadata,
                Path(str(temp_dir)),
            )
        except Exception as exc:
            _append_caption_resolution_warning(context, str(exc))
            return

        if transcript_segments:
            context.data["transcript_segments"] = list(transcript_segments)
            context.data["transcript_source"] = "captions:provider"
