from __future__ import annotations

import tempfile
from pathlib import Path

from workers.common.pipeline import PipelineContext, PipelineStep
from workers.knowledge.runtime import KnowledgeVideoDownloader


class DownloadKnowledgeVideoStep(PipelineStep):
    step_name = "DownloadKnowledgeVideoStep"

    def __init__(
        self,
        video_downloader: KnowledgeVideoDownloader | None = None,
    ) -> None:
        self._video_downloader = video_downloader

    async def _process(self, context: PipelineContext) -> None:
        video_metadata = context.data.get("video_metadata")
        if video_metadata is None:
            raise RuntimeError("Knowledge metadata must be fetched before downloading.")

        existing_video_path = context.data.get("video_path")
        if existing_video_path and Path(str(existing_video_path)).exists():
            return

        temp_dir = context.data.get("temp_dir")
        if temp_dir is None:
            temp_dir_root = context.conf.get("temp_dir_root")
            temp_dir = tempfile.mkdtemp(prefix="cerul-knowledge-", dir=temp_dir_root or None)
            context.data["temp_dir"] = temp_dir

        downloader = self._video_downloader or context.conf.get("video_downloader")
        if downloader is None:
            raise RuntimeError("A knowledge video downloader is required.")

        video_path = await downloader.download_video(video_metadata, Path(str(temp_dir)))
        resolved_video_path = Path(video_path)
        if not resolved_video_path.exists():
            raise FileNotFoundError(f"Downloaded video does not exist: {resolved_video_path}")

        context.data["video_path"] = str(resolved_video_path)
