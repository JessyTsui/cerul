from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from backend.app.embedding import EmbeddingBackend, GeminiEmbeddingBackend
from workers.common.pipeline import PipelineContext, PipelineExecutor

from .repository import (
    KnowledgeRepository,
    resolve_default_knowledge_repository,
)
from .runtime import (
    HeuristicFrameAnalyzer,
    HeuristicSceneDetector,
    HttpVideoDownloader,
    KnowledgeFrameAnalyzer,
    KnowledgeMetadataClient,
    KnowledgeSceneDetector,
    KnowledgeTranscriber,
    KnowledgeVideoDownloader,
)
from .steps import (
    AnalyzeKnowledgeFramesStep,
    DownloadKnowledgeVideoStep,
    EmbedKnowledgeSegmentsStep,
    FetchKnowledgeMetadataStep,
    MarkKnowledgeJobCompletedStep,
    SegmentKnowledgeTranscriptStep,
    StoreKnowledgeSegmentsStep,
    TranscribeKnowledgeVideoStep,
    DetectKnowledgeScenesStep,
)


class KnowledgeIndexingPipeline:
    def __init__(
        self,
        repository: KnowledgeRepository | None = None,
        embedding_backend: EmbeddingBackend | None = None,
        metadata_client: KnowledgeMetadataClient | None = None,
        video_downloader: KnowledgeVideoDownloader | None = None,
        transcriber: KnowledgeTranscriber | None = None,
        scene_detector: KnowledgeSceneDetector | None = None,
        frame_analyzer: KnowledgeFrameAnalyzer | None = None,
        temp_dir_root: str | None = None,
    ) -> None:
        self._repository = repository or resolve_default_knowledge_repository()
        self._embedding_backend = embedding_backend or GeminiEmbeddingBackend()
        self._metadata_client = metadata_client
        self._video_downloader = video_downloader or HttpVideoDownloader()
        self._transcriber = transcriber
        self._scene_detector = scene_detector or HeuristicSceneDetector()
        self._frame_analyzer = frame_analyzer or HeuristicFrameAnalyzer()
        self._temp_dir_root = temp_dir_root
        self._executor = PipelineExecutor(
            [
                FetchKnowledgeMetadataStep(metadata_client=self._metadata_client),
                DownloadKnowledgeVideoStep(video_downloader=self._video_downloader),
                TranscribeKnowledgeVideoStep(transcriber=self._transcriber),
                DetectKnowledgeScenesStep(scene_detector=self._scene_detector),
                AnalyzeKnowledgeFramesStep(frame_analyzer=self._frame_analyzer),
                SegmentKnowledgeTranscriptStep(),
                EmbedKnowledgeSegmentsStep(
                    embedding_backend=self._embedding_backend,
                ),
                StoreKnowledgeSegmentsStep(repository=self._repository),
                MarkKnowledgeJobCompletedStep(repository=self._repository),
            ]
        )

    async def run(
        self,
        video_id: str,
        *,
        job_id: str | None = None,
        source_metadata: Mapping[str, Any] | None = None,
        conf: Mapping[str, Any] | None = None,
    ) -> PipelineContext:
        runtime_conf = dict(conf or {})
        runtime_conf.setdefault("repository", self._repository)
        runtime_conf.setdefault("embedding_backend", self._embedding_backend)
        runtime_conf.setdefault("metadata_client", self._metadata_client)
        runtime_conf.setdefault("video_downloader", self._video_downloader)
        runtime_conf.setdefault("transcriber", self._transcriber)
        runtime_conf.setdefault("scene_detector", self._scene_detector)
        runtime_conf.setdefault("frame_analyzer", self._frame_analyzer)
        runtime_conf.setdefault("temp_dir_root", self._temp_dir_root)

        context = PipelineContext(
            conf=runtime_conf,
            data={
                "video_id": video_id,
                "track": "knowledge",
                "source": "youtube",
            },
        )
        if job_id is not None:
            context.data["job_id"] = job_id
        if source_metadata is not None:
            context.data["source_metadata"] = dict(source_metadata)

        return await self._executor.run(context)
