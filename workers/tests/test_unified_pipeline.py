import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

import pytest

from workers.common.pipeline import PipelineContext
from workers.unified import (
    AsyncpgUnifiedRepository,
    InMemoryUnifiedRepository,
    UnifiedIndexingPipeline,
)


def run_async(coro):
    return asyncio.run(coro)


class StubEmbeddingBackend:
    def __init__(self) -> None:
        self.calls: list[tuple[object, ...]] = []

    def embed_text(self, text: str) -> list[float]:
        self.calls.append(("text", text))
        return [float(len(text)), 0.1, 0.2]

    def embed_multimodal(
        self,
        text: str,
        *,
        image_paths: list[str] | None = None,
    ) -> list[float]:
        self.calls.append(("multimodal", text, tuple(image_paths or [])))
        return [0.3, 0.4, 0.5]


class StubVideoDownloader:
    async def download_video(self, video_metadata, output_dir: Path) -> Path:
        video_path = output_dir / "demo.mp4"
        video_path.write_bytes(b"fake video")
        return video_path


class StubSummaryGenerator:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def available(self) -> bool:
        return True

    async def summarize(self, **kwargs: object) -> str:
        self.calls.append(dict(kwargs))
        return "LLM summary about agent workflows, slide evidence, and the main claim."


class StubFrameUploader:
    def __init__(self, *, available: bool = True) -> None:
        self._available = available
        self.calls: list[tuple[str, list[tuple[int, str]]]] = []

    def available(self) -> bool:
        return self._available

    async def upload_frames_batch(
        self,
        video_id: str,
        frame_entries: list[tuple[int, Path]],
        max_concurrency: int = 10,
    ) -> dict[int, str]:
        del max_concurrency
        normalized_entries = [(index, str(path)) for index, path in frame_entries]
        self.calls.append((video_id, normalized_entries))
        return {
            index: f"https://cdn.cerul.ai/frames/{video_id}/{index:03d}.jpg"
            for index, _ in frame_entries
        }


class StubSceneDetector:
    async def detect_scenes(
        self,
        video_path,
        *,
        transcript_segments,
        video_metadata,
        threshold: float,
    ):
        return [
            {
                "scene_index": 0,
                "timestamp_start": 0.0,
                "timestamp_end": 4.0,
            }
        ]


class StubFrameAnalyzer:
    async def analyze_scene(
        self,
        video_path,
        *,
        scene,
        transcript_segments,
        video_metadata,
        log_event=None,
    ):
        frame_path = Path(video_path).with_name("frame-000.jpg")
        frame_path.write_bytes(b"fake frame")
        return {
            "scene_index": scene["scene_index"],
            "visual_description": "Hands typing on a laptop during a deployment demo.",
            "visual_text_content": "deploy now",
            "visual_type": "product_demo",
            "frame_paths": [str(frame_path)],
            "keywords": ["deployment", "demo"],
        }


class DeletedJobRepository(InMemoryUnifiedRepository):
    async def job_exists(self, job_id: str | None) -> bool:
        return False


class CancelDuringPersistRepository(InMemoryUnifiedRepository):
    def __init__(self) -> None:
        super().__init__()
        self._job_exists_calls = 0

    async def job_exists(self, job_id: str | None) -> bool:
        self._job_exists_calls += 1
        return self._job_exists_calls < 3


class _FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakeUnifiedRepositoryConnection:
    def __init__(self, update_result: str) -> None:
        self.update_result = update_result
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []
        self.closed = False

    def transaction(self) -> _FakeTransaction:
        return _FakeTransaction()

    async def execute(self, query: str, *params: object) -> str:
        self.execute_calls.append((query, params))
        if "UPDATE processing_jobs" in query:
            return self.update_result
        return "INSERT 0 1"

    async def close(self) -> None:
        self.closed = True


def test_unified_pipeline_transforms_knowledge_segments_into_retrieval_units() -> None:
    repository = InMemoryUnifiedRepository()
    embedding_backend = StubEmbeddingBackend()
    summary_generator = StubSummaryGenerator()
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=embedding_backend,
        summary_generator=summary_generator,
        frame_uploader=StubFrameUploader(),
    )

    knowledge_context = PipelineContext(
        data={
            "stored_video": {
                "source_video_id": "abc123xyz00",
                "source_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "video_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "thumbnail_url": "https://img.youtube.com/vi/abc123xyz00/hqdefault.jpg",
                "title": "AGI Timeline",
                "description": "A long-form interview about AGI.",
                "speaker": "Sam Altman",
                "published_at": None,
                "duration_seconds": 600,
                "license": None,
                "metadata": {"creator": "Lex Fridman"},
            },
            "stored_segments": [
                {
                    "segment_index": 0,
                    "timestamp_start": 12.0,
                    "timestamp_end": 48.0,
                    "transcript_text": "AGI is coming sooner than most people expect.",
                    "visual_description": "Slide with an AGI roadmap and milestone arrows.",
                    "visual_text_content": "AGI roadmap",
                    "visual_type": "slide",
                    "title": "AGI timeline",
                    "metadata": {"keywords": ["agi", "timeline"]},
                    "embedding": [0.11, 0.22, 0.33],
                }
            ],
        },
        completed_steps=["StoreKnowledgeSegmentsStep"],
    )

    mocked_pipeline = Mock()
    mocked_pipeline.run = AsyncMock(return_value=knowledge_context)

    with patch(
        "workers.unified.pipeline.KnowledgeIndexingPipeline",
        return_value=mocked_pipeline,
    ):
        context = run_async(
            pipeline.run(
                url="https://www.youtube.com/watch?v=abc123xyz00",
                source="youtube",
                source_video_id="abc123xyz00",
                owner_id="user-123",
                video_id="video-123",
                job_id="job-123",
                conf={"scene_threshold": 0.2},
            )
        )

    stored_video = context.data["stored_unified_video"]
    stored_units = repository.units_by_video_id[stored_video["id"]]

    kwargs = mocked_pipeline.run.await_args.kwargs
    assert kwargs["video_id"] == "abc123xyz00"
    assert kwargs["job_id"] == "job-123"
    assert kwargs["conf"]["scene_threshold"] == 0.2
    assert "step_timeouts" in kwargs["conf"]
    assert "step_timeout_guidance" in kwargs["conf"]
    assert stored_video["id"] == "video-123"
    assert repository.access_by_video_id["video-123"] == {"user-123"}
    assert [unit["unit_type"] for unit in stored_units] == ["summary", "speech", "visual"]
    assert stored_units[0]["content_text"] == (
        "LLM summary about agent workflows, slide evidence, and the main claim."
    )
    assert stored_units[0]["metadata"]["summary_source"] == "gemini_flash"
    assert stored_units[0]["keyframe_url"] == "https://img.youtube.com/vi/abc123xyz00/hqdefault.jpg"
    assert context.data["indexed_unit_count"] == 3
    assert context.data["job_artifacts"] == {
        "video_id": "video-123",
        "units_created": 3,
        "source": "youtube",
    }
    assert stored_units[1]["embedding"] == [0.11, 0.22, 0.33]
    assert stored_units[1]["keyframe_url"] == "https://img.youtube.com/vi/abc123xyz00/hqdefault.jpg"
    assert stored_units[2]["embedding"] == [0.11, 0.22, 0.33]
    assert stored_units[2]["metadata"]["embedding_source"] == "segment"
    assert stored_units[2]["keyframe_url"] == "https://img.youtube.com/vi/abc123xyz00/hqdefault.jpg"
    assert not any(call[0] == "multimodal" for call in embedding_backend.calls)
    assert repository.completed_jobs["job-123"]["units_created"] == 3
    assert summary_generator.calls[0]["title"] == "AGI Timeline"


def test_unified_pipeline_skips_persist_when_job_was_deleted() -> None:
    repository = DeletedJobRepository()
    embedding_backend = StubEmbeddingBackend()
    summary_generator = StubSummaryGenerator()
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=embedding_backend,
        summary_generator=summary_generator,
        frame_uploader=StubFrameUploader(),
    )

    knowledge_context = PipelineContext(
        data={
            "stored_video": {
                "source_video_id": "abc123xyz00",
                "source_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "video_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "thumbnail_url": "https://img.youtube.com/vi/abc123xyz00/hqdefault.jpg",
                "title": "AGI Timeline",
                "description": "A long-form interview about AGI.",
                "speaker": "Sam Altman",
                "published_at": None,
                "duration_seconds": 600,
                "license": None,
                "metadata": {"creator": "Lex Fridman"},
            },
            "stored_segments": [
                {
                    "segment_index": 0,
                    "timestamp_start": 12.0,
                    "timestamp_end": 48.0,
                    "transcript_text": "AGI is coming sooner than most people expect.",
                    "visual_description": "Slide with an AGI roadmap and milestone arrows.",
                    "visual_text_content": "AGI roadmap",
                    "visual_type": "slide",
                    "title": "AGI timeline",
                    "metadata": {"keywords": ["agi", "timeline"]},
                    "embedding": [0.11, 0.22, 0.33],
                }
            ],
        },
        completed_steps=["StoreKnowledgeSegmentsStep"],
    )

    mocked_pipeline = Mock()
    mocked_pipeline.run = AsyncMock(return_value=knowledge_context)

    with patch(
        "workers.unified.pipeline.KnowledgeIndexingPipeline",
        return_value=mocked_pipeline,
    ):
        context = run_async(
            pipeline.run(
                url="https://www.youtube.com/watch?v=abc123xyz00",
                source="youtube",
                source_video_id="abc123xyz00",
                owner_id="user-123",
                video_id="video-123",
                job_id="job-deleted",
                conf={"scene_threshold": 0.2},
            )
        )

    assert repository.units_by_video_id == {}
    assert repository.access_by_video_id == {}
    assert context.data["indexed_unit_count"] == 0
    assert context.data["stored_unified_video"]["id"] == "video-123"


def test_unified_pipeline_skips_unit_replace_when_job_is_cancelled_mid_persist() -> None:
    repository = CancelDuringPersistRepository()
    embedding_backend = StubEmbeddingBackend()
    summary_generator = StubSummaryGenerator()
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=embedding_backend,
        summary_generator=summary_generator,
        frame_uploader=StubFrameUploader(),
    )

    knowledge_context = PipelineContext(
        data={
            "stored_video": {
                "source_video_id": "abc123xyz00",
                "source_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "video_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "thumbnail_url": "https://img.youtube.com/vi/abc123xyz00/hqdefault.jpg",
                "title": "AGI Timeline",
                "description": "A long-form interview about AGI.",
                "speaker": "Sam Altman",
                "published_at": None,
                "duration_seconds": 600,
                "license": None,
                "metadata": {"creator": "Lex Fridman"},
            },
            "stored_segments": [
                {
                    "segment_index": 0,
                    "timestamp_start": 12.0,
                    "timestamp_end": 48.0,
                    "transcript_text": "AGI is coming sooner than most people expect.",
                    "visual_description": "Slide with an AGI roadmap and milestone arrows.",
                    "visual_text_content": "AGI roadmap",
                    "visual_type": "slide",
                    "title": "AGI timeline",
                    "metadata": {"keywords": ["agi", "timeline"]},
                    "embedding": [0.11, 0.22, 0.33],
                }
            ],
        },
        completed_steps=["StoreKnowledgeSegmentsStep"],
    )

    mocked_pipeline = Mock()
    mocked_pipeline.run = AsyncMock(return_value=knowledge_context)

    with patch(
        "workers.unified.pipeline.KnowledgeIndexingPipeline",
        return_value=mocked_pipeline,
    ):
        context = run_async(
            pipeline.run(
                url="https://www.youtube.com/watch?v=abc123xyz00",
                source="youtube",
                source_video_id="abc123xyz00",
                owner_id="user-123",
                video_id="video-123",
                job_id="job-cancelled-mid-persist",
                conf={"scene_threshold": 0.2},
            )
        )

    assert repository.units_by_video_id == {}
    assert repository.completed_jobs == {}
    assert context.data["indexed_unit_count"] == 0


def test_unified_pipeline_ignores_telemetry_callback_failures() -> None:
    repository = InMemoryUnifiedRepository()
    embedding_backend = StubEmbeddingBackend()
    summary_generator = StubSummaryGenerator()
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=embedding_backend,
        summary_generator=summary_generator,
        frame_uploader=StubFrameUploader(),
    )

    knowledge_context = PipelineContext(
        data={
            "stored_video": {
                "source_video_id": "abc123xyz00",
                "source_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "video_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "thumbnail_url": "https://img.youtube.com/vi/abc123xyz00/hqdefault.jpg",
                "title": "AGI Timeline",
                "description": "A long-form interview about AGI.",
                "speaker": "Sam Altman",
                "published_at": None,
                "duration_seconds": 600,
                "license": None,
                "metadata": {"creator": "Lex Fridman"},
            },
            "stored_segments": [
                {
                    "segment_index": 0,
                    "timestamp_start": 12.0,
                    "timestamp_end": 48.0,
                    "transcript_text": "AGI is coming sooner than most people expect.",
                    "visual_description": "Slide with an AGI roadmap and milestone arrows.",
                    "visual_text_content": "AGI roadmap",
                    "visual_type": "slide",
                    "title": "AGI timeline",
                    "metadata": {"keywords": ["agi", "timeline"]},
                    "embedding": [0.11, 0.22, 0.33],
                }
            ],
        },
        completed_steps=["StoreKnowledgeSegmentsStep"],
    )

    mocked_pipeline = Mock()
    mocked_pipeline.run = AsyncMock(return_value=knowledge_context)

    async def progress_callback(step_name: str, status: str, context: PipelineContext) -> None:
        del step_name, status, context
        raise RuntimeError("progress callback unavailable")

    async def step_log_callback(
        step_name: str,
        level: str,
        message: str,
        details: dict[str, object],
        context: PipelineContext,
    ) -> None:
        del step_name, level, message, details, context
        raise RuntimeError("step log callback unavailable")

    with patch(
        "workers.unified.pipeline.KnowledgeIndexingPipeline",
        return_value=mocked_pipeline,
    ):
        context = run_async(
            pipeline.run(
                url="https://www.youtube.com/watch?v=abc123xyz00",
                source="youtube",
                source_video_id="abc123xyz00",
                owner_id="user-123",
                video_id="video-123",
                job_id="job-telemetry-errors",
                conf={
                    "scene_threshold": 0.2,
                    "progress_callback": progress_callback,
                    "step_log_callback": step_log_callback,
                },
            )
        )

    assert context.error is None
    assert context.data["indexed_unit_count"] == 3
    assert repository.completed_jobs["job-telemetry-errors"]["units_created"] == 3


def test_unified_pipeline_builds_visual_units_for_direct_video(tmp_path) -> None:
    repository = InMemoryUnifiedRepository()
    embedding_backend = StubEmbeddingBackend()
    summary_generator = StubSummaryGenerator()
    frame_uploader = StubFrameUploader()
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=embedding_backend,
        frame_analyzer=StubFrameAnalyzer(),
        scene_detector=StubSceneDetector(),
        summary_generator=summary_generator,
        video_downloader=StubVideoDownloader(),
        frame_uploader=frame_uploader,
        temp_dir_root=str(tmp_path),
    )

    with patch.object(
        pipeline,
        "_probe_duration_seconds",
        AsyncMock(return_value=15),
    ):
        context = run_async(
            pipeline.run(
                url="https://cdn.example.com/demo.mp4",
                source="upload",
                source_video_id="upload-demo-123",
                owner_id="user-456",
                job_id="job-upload-1",
                conf=None,
            )
        )

    stored_video = context.data["stored_unified_video"]
    stored_units = repository.units_by_video_id[stored_video["id"]]

    assert context.data["video_metadata"]["duration_seconds"] == 15
    assert context.completed_steps == [
        "FetchUnifiedMetadataStep",
        "DownloadKnowledgeVideoStep",
        "DetectKnowledgeScenesStep",
        "AnalyzeKnowledgeFramesStep",
        "BuildUnifiedRetrievalUnitsStep",
        "EmbedUnifiedUnitsStep",
        "PersistUnifiedUnitsStep",
        "MarkUnifiedJobCompletedStep",
    ]
    assert stored_video["source"] == "upload"
    assert repository.access_by_video_id[stored_video["id"]] == {"user-456"}
    assert [unit["unit_type"] for unit in stored_units] == ["summary", "visual"]
    assert stored_units[0]["metadata"]["summary_source"] == "gemini_flash"
    assert stored_units[0]["keyframe_url"] is None
    assert stored_units[1]["keyframe_url"] == (
        f"https://cdn.cerul.ai/frames/{stored_video['source_video_id']}/000.jpg"
    )
    assert context.data["job_artifacts"] == {
        "video_id": stored_video["id"],
        "units_created": 2,
        "source": "upload",
    }
    assert any(call[0] == "multimodal" for call in embedding_backend.calls)
    assert len(frame_uploader.calls) == 1
    assert frame_uploader.calls[0][0] == "upload-demo-123"
    assert frame_uploader.calls[0][1][0][0] == 0
    assert frame_uploader.calls[0][1][0][1].endswith("/frame-000.jpg")
    assert summary_generator.calls[0]["source"] == "upload"
    assert list(tmp_path.iterdir()) == []


def test_unified_pipeline_cleans_temp_dir_after_visual_pipeline_failure(tmp_path) -> None:
    repository = InMemoryUnifiedRepository()
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=StubEmbeddingBackend(),
        frame_analyzer=StubFrameAnalyzer(),
        scene_detector=StubSceneDetector(),
        summary_generator=StubSummaryGenerator(),
        video_downloader=StubVideoDownloader(),
        temp_dir_root=str(tmp_path),
    )

    with patch.object(
        pipeline,
        "_probe_duration_seconds",
        AsyncMock(return_value=4 * 60 * 60 + 1),
    ):
        with pytest.raises(ValueError, match="4 hours"):
            run_async(
                pipeline.run(
                    url="https://cdn.example.com/too-long.mp4",
                    source="upload",
                    source_video_id="upload-too-long",
                    owner_id="user-456",
                    job_id="job-upload-fail",
                    conf=None,
                )
            )

    assert list(tmp_path.iterdir()) == []


def test_unified_pipeline_uploads_segment_keyframes_when_r2_is_available(tmp_path) -> None:
    repository = InMemoryUnifiedRepository()
    embedding_backend = StubEmbeddingBackend()
    summary_generator = StubSummaryGenerator()
    frame_uploader = StubFrameUploader()
    frame_path = tmp_path / "frame-001.jpg"
    frame_path.write_bytes(b"frame")
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=embedding_backend,
        summary_generator=summary_generator,
        frame_uploader=frame_uploader,
    )

    knowledge_context = PipelineContext(
        data={
            "stored_video": {
                "id": "knowledge-video-1",
                "source_video_id": "abc123xyz00",
                "source_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "video_url": "https://www.youtube.com/watch?v=abc123xyz00",
                "thumbnail_url": "https://img.youtube.com/vi/abc123xyz00/hqdefault.jpg",
                "title": "AGI Timeline",
                "description": "A long-form interview about AGI.",
                "speaker": "Sam Altman",
                "published_at": None,
                "duration_seconds": 600,
                "license": None,
                "metadata": {"creator": "Lex Fridman"},
            },
            "stored_segments": [
                {
                    "segment_index": 0,
                    "timestamp_start": 12.0,
                    "timestamp_end": 48.0,
                    "transcript_text": "AGI is coming sooner than most people expect.",
                    "visual_description": "Slide with an AGI roadmap and milestone arrows.",
                    "visual_text_content": "AGI roadmap",
                    "visual_type": "slide",
                    "title": "AGI timeline",
                    "metadata": {"keywords": ["agi", "timeline"]},
                    "embedding": [0.11, 0.22, 0.33],
                    "frame_paths": [str(frame_path)],
                }
            ],
        },
        completed_steps=["StoreKnowledgeSegmentsStep"],
    )

    mocked_pipeline = Mock()
    mocked_pipeline.run = AsyncMock(return_value=knowledge_context)

    with patch(
        "workers.unified.pipeline.KnowledgeIndexingPipeline",
        return_value=mocked_pipeline,
    ):
        context = run_async(
            pipeline.run(
                url="https://www.youtube.com/watch?v=abc123xyz00",
                source="youtube",
                source_video_id="abc123xyz00",
                owner_id="user-123",
                video_id="video-123",
                job_id="job-123",
                conf={"scene_threshold": 0.2},
            )
        )

    stored_video = context.data["stored_unified_video"]
    stored_units = repository.units_by_video_id[stored_video["id"]]

    assert frame_uploader.calls == [("knowledge-video-1", [(0, str(frame_path))])]
    assert stored_units[1]["keyframe_url"] == "https://cdn.cerul.ai/frames/knowledge-video-1/000.jpg"
    assert stored_units[2]["keyframe_url"] == "https://cdn.cerul.ai/frames/knowledge-video-1/000.jpg"


def test_unified_pipeline_extracts_keyframe_for_text_only_speech_units(tmp_path) -> None:
    repository = InMemoryUnifiedRepository()
    embedding_backend = StubEmbeddingBackend()
    summary_generator = StubSummaryGenerator()
    frame_uploader = StubFrameUploader()
    video_path = tmp_path / "knowledge-demo.mp4"
    video_path.write_bytes(b"fake video")
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=embedding_backend,
        summary_generator=summary_generator,
        frame_uploader=frame_uploader,
    )

    knowledge_context = PipelineContext(
        data={
            "video_path": str(video_path),
            "stored_video": {
                "id": "knowledge-video-2",
                "source_video_id": "speech-only-123",
                "source_url": "https://www.youtube.com/watch?v=speech-only-123",
                "video_url": "https://www.youtube.com/watch?v=speech-only-123",
                "thumbnail_url": "https://img.youtube.com/vi/speech-only-123/hqdefault.jpg",
                "title": "Speech Only Demo",
                "description": "A transcript-led segment.",
                "speaker": "Host",
                "published_at": None,
                "duration_seconds": 180,
                "license": None,
                "metadata": {},
            },
            "stored_segments": [
                {
                    "segment_index": 0,
                    "timestamp_start": 33.5,
                    "timestamp_end": 41.0,
                    "transcript_text": "Memory could become a durable product advantage.",
                    "visual_description": "",
                    "visual_text_content": "",
                    "visual_type": None,
                    "title": "Core claim",
                    "metadata": {"keywords": ["memory"]},
                    "embedding": [0.11, 0.22, 0.33],
                    "frame_paths": [],
                }
            ],
        },
        completed_steps=["StoreKnowledgeSegmentsStep"],
    )

    mocked_pipeline = Mock()
    mocked_pipeline.run = AsyncMock(return_value=knowledge_context)

    async def fake_capture(*, video_path: Path, timestamp_seconds: float, output_path: Path) -> Path:
        assert video_path.name == "knowledge-demo.mp4"
        assert timestamp_seconds == 33.5
        return output_path

    with patch(
        "workers.unified.pipeline.KnowledgeIndexingPipeline",
        return_value=mocked_pipeline,
    ):
        with patch.object(
            pipeline,
            "_capture_video_frame",
            AsyncMock(side_effect=fake_capture),
        ):
            context = run_async(
                pipeline.run(
                    url="https://www.youtube.com/watch?v=speech-only-123",
                    source="youtube",
                    source_video_id="speech-only-123",
                    owner_id="user-789",
                    video_id="video-456",
                    job_id="job-456",
                    conf={"scene_threshold": 0.2},
                )
            )

    stored_video = context.data["stored_unified_video"]
    stored_units = repository.units_by_video_id[stored_video["id"]]

    assert frame_uploader.calls == [
        (
            "knowledge-video-2",
            [(0, str(video_path.parent / "unified-keyframes" / "000.jpg"))],
        )
    ]
    assert [unit["unit_type"] for unit in stored_units] == ["summary", "speech"]
    assert stored_units[1]["keyframe_url"] == "https://cdn.cerul.ai/frames/knowledge-video-2/000.jpg"


def test_unified_pipeline_dedupes_missing_keyframe_captures_by_timestamp(tmp_path) -> None:
    repository = InMemoryUnifiedRepository()
    embedding_backend = StubEmbeddingBackend()
    summary_generator = StubSummaryGenerator()
    frame_uploader = StubFrameUploader()
    video_path = tmp_path / "knowledge-demo.mp4"
    video_path.write_bytes(b"fake video")
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=embedding_backend,
        summary_generator=summary_generator,
        frame_uploader=frame_uploader,
    )

    knowledge_context = PipelineContext(
        data={
            "video_path": str(video_path),
            "stored_video": {
                "id": "knowledge-video-3",
                "source_video_id": "shared-ts-123",
                "source_url": "https://www.youtube.com/watch?v=shared-ts-123",
                "video_url": "https://www.youtube.com/watch?v=shared-ts-123",
                "thumbnail_url": "https://img.youtube.com/vi/shared-ts-123/hqdefault.jpg",
                "title": "Shared Timestamp Demo",
                "description": "Two transcript units share the same start time.",
                "speaker": "Host",
                "published_at": None,
                "duration_seconds": 180,
                "license": None,
                "metadata": {},
            },
            "stored_segments": [
                {
                    "segment_index": 0,
                    "timestamp_start": 33.5,
                    "timestamp_end": 40.0,
                    "transcript_text": "Memory helps preserve state.",
                    "visual_description": "",
                    "visual_text_content": "",
                    "visual_type": None,
                    "title": "First claim",
                    "metadata": {"keywords": ["memory"]},
                    "embedding": [0.11, 0.22, 0.33],
                    "frame_paths": [],
                },
                {
                    "segment_index": 1,
                    "timestamp_start": 33.5,
                    "timestamp_end": 45.0,
                    "transcript_text": "The same moment should reuse one screenshot.",
                    "visual_description": "",
                    "visual_text_content": "",
                    "visual_type": None,
                    "title": "Second claim",
                    "metadata": {"keywords": ["reuse"]},
                    "embedding": [0.44, 0.55, 0.66],
                    "frame_paths": [],
                },
            ],
        },
        completed_steps=["StoreKnowledgeSegmentsStep"],
    )

    mocked_pipeline = Mock()
    mocked_pipeline.run = AsyncMock(return_value=knowledge_context)

    with patch(
        "workers.unified.pipeline.KnowledgeIndexingPipeline",
        return_value=mocked_pipeline,
    ):
        with patch.object(
            pipeline,
            "_capture_video_frame",
            AsyncMock(return_value=video_path.parent / "unified-keyframes" / "000.jpg"),
        ) as capture_mock:
            context = run_async(
                pipeline.run(
                    url="https://www.youtube.com/watch?v=shared-ts-123",
                    source="youtube",
                    source_video_id="shared-ts-123",
                    owner_id="user-999",
                    video_id="video-999",
                    job_id="job-999",
                    conf={"scene_threshold": 0.2},
                )
            )

    stored_video = context.data["stored_unified_video"]
    stored_units = repository.units_by_video_id[stored_video["id"]]

    assert capture_mock.await_count == 1
    assert frame_uploader.calls == [
        (
            "knowledge-video-3",
            [
                (0, str(video_path.parent / "unified-keyframes" / "000.jpg")),
                (1, str(video_path.parent / "unified-keyframes" / "000.jpg")),
            ],
        )
    ]
    assert [unit["unit_type"] for unit in stored_units] == ["summary", "speech", "speech"]
    assert stored_units[1]["keyframe_url"] == "https://cdn.cerul.ai/frames/knowledge-video-3/000.jpg"
    assert stored_units[2]["keyframe_url"] == "https://cdn.cerul.ai/frames/knowledge-video-3/001.jpg"


def test_unified_pipeline_surfaces_knowledge_pipeline_errors() -> None:
    repository = InMemoryUnifiedRepository()
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=StubEmbeddingBackend(),
        summary_generator=StubSummaryGenerator(),
    )
    knowledge_context = PipelineContext(
        failed_step="FetchKnowledgeMetadataStep",
        error="YOUTUBE_API_KEY is required to query YouTube.",
    )
    mocked_pipeline = Mock()
    mocked_pipeline.run = AsyncMock(return_value=knowledge_context)

    with patch(
        "workers.unified.pipeline.KnowledgeIndexingPipeline",
        return_value=mocked_pipeline,
    ):
        with pytest.raises(RuntimeError, match="YOUTUBE_API_KEY is required to query YouTube."):
            run_async(
                pipeline.run(
                    url="https://www.youtube.com/watch?v=abc123xyz00",
                    source="youtube",
                    source_video_id="abc123xyz00",
                    owner_id="user-123",
                    video_id="video-123",
                    job_id="job-123",
                    conf=None,
                )
            )


def test_unified_pipeline_limits_visual_unit_embedding_frames_to_two(tmp_path) -> None:
    repository = InMemoryUnifiedRepository()
    embedding_backend = StubEmbeddingBackend()
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=embedding_backend,
        summary_generator=StubSummaryGenerator(),
    )
    frame_paths: list[str] = []
    for index in range(3):
        frame_path = tmp_path / f"frame-{index}.jpg"
        frame_path.write_bytes(b"frame")
        frame_paths.append(str(frame_path))

    embedding = run_async(
        pipeline._embed_visual_unit(
            content_text="Scene with diagrams and charts",
            frame_paths=frame_paths,
        )
    )

    assert embedding == [0.3, 0.4, 0.5]
    multimodal_calls = [call for call in embedding_backend.calls if call[0] == "multimodal"]
    assert multimodal_calls == [
        ("multimodal", "Scene with diagrams and charts", tuple(frame_paths[:2]))
    ]


def test_unified_pipeline_rejects_videos_longer_than_four_hours(tmp_path) -> None:
    repository = InMemoryUnifiedRepository()
    pipeline = UnifiedIndexingPipeline(
        repository=repository,
        embedding_backend=StubEmbeddingBackend(),
        frame_analyzer=StubFrameAnalyzer(),
        scene_detector=StubSceneDetector(),
        summary_generator=StubSummaryGenerator(),
        video_downloader=StubVideoDownloader(),
        temp_dir_root=str(tmp_path),
    )

    with patch.object(
        pipeline,
        "_probe_duration_seconds",
        AsyncMock(return_value=4 * 60 * 60 + 1),
    ):
        with patch.object(
            pipeline,
            "_fetch_visual_video_metadata",
            AsyncMock(
                return_value={
                    "source": "upload",
                    "source_video_id": "upload-long-video",
                    "source_url": "https://cdn.example.com/long.mp4",
                    "video_url": "https://cdn.example.com/long.mp4",
                    "thumbnail_url": None,
                    "title": "Long Recording",
                    "description": "A very long recording.",
                    "duration_seconds": None,
                    "license": None,
                    "creator": "Creator",
                    "metadata": {},
                }
            ),
        ):
            with pytest.raises(ValueError, match="4 hours"):
                run_async(
                    pipeline.run(
                        url="https://cdn.example.com/long.mp4",
                        source="upload",
                        source_video_id="upload-long-video",
                        owner_id="user-999",
                        job_id="job-long-video",
                        conf=None,
                    )
                )


def test_asyncpg_unified_repository_skips_completion_step_for_cancelled_job() -> None:
    repository = AsyncpgUnifiedRepository("postgresql://example")
    connection = FakeUnifiedRepositoryConnection(update_result="UPDATE 0")

    with patch.object(repository, "job_exists", AsyncMock(return_value=True)):
        with patch.object(repository, "_connect", AsyncMock(return_value=connection)):
            run_async(
                repository.mark_job_completed(
                    "11111111-1111-1111-1111-111111111111",
                    {"units_created": 3},
                )
            )

    assert len(connection.execute_calls) == 1
    assert "UPDATE processing_jobs" in connection.execute_calls[0][0]
    assert connection.closed is True
