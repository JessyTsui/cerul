from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from backend.app.embedding import EmbeddingBackend, create_embedding_backend
from workers.common.sources import YouTubeClient
from workers.common.pipeline import PipelineContext, PipelineExecutor

from .repository import (
    KnowledgeRepository,
    resolve_default_knowledge_repository,
)
from .runtime import (
    HeuristicFrameAnalyzer,
    HeuristicSceneDetector,
    HttpVideoDownloader,
    KnowledgeCaptionProvider,
    KnowledgeFrameAnalyzer,
    KnowledgeMetadataClient,
    KnowledgeSceneDetector,
    KnowledgeTranscriber,
    KnowledgeVideoDownloader,
    OpenAICompatibleTranscriber,
    YtDlpCaptionProvider,
    YtDlpVideoDownloader,
)
from .steps import (
    AnalyzeKnowledgeFramesStep,
    DownloadKnowledgeVideoStep,
    EmbedKnowledgeSegmentsStep,
    FetchKnowledgeCaptionsStep,
    FetchKnowledgeMetadataStep,
    MarkKnowledgeJobCompletedStep,
    SegmentKnowledgeTranscriptStep,
    StoreKnowledgeSegmentsStep,
    TranscribeKnowledgeVideoStep,
    DetectKnowledgeScenesStep,
)

DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION = 3072
DEFAULT_KNOWLEDGE_STEP_TIMEOUTS: dict[str, float] = {
    "FetchKnowledgeMetadataStep": 45.0,
    "FetchKnowledgeCaptionsStep": 60.0,
    "DownloadKnowledgeVideoStep": 480.0,
    "TranscribeKnowledgeVideoStep": 900.0,
    "DetectKnowledgeScenesStep": 90.0,
    "AnalyzeKnowledgeFramesStep": 600.0,
    "SegmentKnowledgeTranscriptStep": 90.0,
    "EmbedKnowledgeSegmentsStep": 300.0,
    "StoreKnowledgeSegmentsStep": 120.0,
}

DEFAULT_KNOWLEDGE_TIMEOUT_GUIDANCE: dict[str, str] = {
    "FetchKnowledgeMetadataStep": "Metadata fetch timed out; check the source endpoint and local proxy path.",
    "FetchKnowledgeCaptionsStep": "Caption resolution timed out; the worker can fall back to ASR, but source caption endpoints may be slow.",
    "DownloadKnowledgeVideoStep": "Video download timed out; inspect yt-dlp, cookies, proxy settings, and source availability.",
    "TranscribeKnowledgeVideoStep": "Transcription timed out; inspect OpenAI connectivity, chunk sizing, and provider latency.",
    "DetectKnowledgeScenesStep": "Scene detection timed out; inspect ffmpeg health and local video readability.",
    "AnalyzeKnowledgeFramesStep": "Frame analysis timed out; this usually means a vision-model request hung. Check Gemini reachability, proxy behavior, or lower frame volume.",
    "SegmentKnowledgeTranscriptStep": "Transcript segmentation timed out; inspect transcript payload size and segmentation heuristics.",
    "EmbedKnowledgeSegmentsStep": "Segment embedding timed out; inspect Gemini embedding latency and outbound connectivity.",
    "StoreKnowledgeSegmentsStep": "Database persistence timed out; inspect Postgres health and lock contention.",
}


class KnowledgeIndexingPipeline:
    def __init__(
        self,
        repository: KnowledgeRepository | None = None,
        embedding_backend: EmbeddingBackend | None = None,
        metadata_client: KnowledgeMetadataClient | None = None,
        caption_provider: KnowledgeCaptionProvider | None = None,
        video_downloader: KnowledgeVideoDownloader | None = None,
        transcriber: KnowledgeTranscriber | None = None,
        scene_detector: KnowledgeSceneDetector | None = None,
        frame_analyzer: KnowledgeFrameAnalyzer | None = None,
        temp_dir_root: str | None = None,
    ) -> None:
        self._repository = repository or resolve_default_knowledge_repository()
        self._embedding_backend = embedding_backend or create_embedding_backend(
            output_dimension=DEFAULT_KNOWLEDGE_EMBEDDING_DIMENSION
        )
        self._metadata_client = metadata_client or YouTubeClient()
        self._caption_provider = caption_provider or YtDlpCaptionProvider()
        self._video_downloader = video_downloader or YtDlpVideoDownloader(
            fallback_downloader=HttpVideoDownloader()
        )
        self._transcriber = transcriber or OpenAICompatibleTranscriber()
        self._scene_detector = scene_detector or HeuristicSceneDetector()
        self._frame_analyzer = frame_analyzer or HeuristicFrameAnalyzer()
        self._temp_dir_root = temp_dir_root
        self._executor = PipelineExecutor(
            [
                FetchKnowledgeMetadataStep(metadata_client=self._metadata_client),
                FetchKnowledgeCaptionsStep(caption_provider=self._caption_provider),
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
        runtime_conf["step_timeouts"] = {
            **DEFAULT_KNOWLEDGE_STEP_TIMEOUTS,
            **dict(runtime_conf.get("step_timeouts") or {}),
        }
        runtime_conf["step_timeout_guidance"] = {
            **DEFAULT_KNOWLEDGE_TIMEOUT_GUIDANCE,
            **dict(runtime_conf.get("step_timeout_guidance") or {}),
        }
        runtime_conf.setdefault("repository", self._repository)
        runtime_conf.setdefault("embedding_backend", self._embedding_backend)
        runtime_conf.setdefault("metadata_client", self._metadata_client)
        runtime_conf.setdefault("caption_provider", self._caption_provider)
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
