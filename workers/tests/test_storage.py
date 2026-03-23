from __future__ import annotations

import asyncio
from pathlib import Path

from backend.app.config import reset_settings_cache
from workers.common.storage import R2FrameUploader


def run_async(coro):
    return asyncio.run(coro)


class RecordingS3Client:
    def __init__(self) -> None:
        self.put_calls: list[dict[str, object]] = []

    def put_object(self, **kwargs: object) -> None:
        self.put_calls.append(kwargs)


def test_r2_frame_uploader_available_requires_public_url(monkeypatch) -> None:
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "access-123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "cerul-cdn")
    monkeypatch.delenv("R2_PUBLIC_URL", raising=False)
    reset_settings_cache()

    uploader = R2FrameUploader()

    assert uploader.available() is False


def test_r2_frame_uploader_uploads_using_public_cdn_url(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "access-123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "cerul-cdn")
    monkeypatch.setenv("R2_PUBLIC_URL", "https://cdn.cerul.ai/")
    reset_settings_cache()

    frame_path = tmp_path / "frame-001.jpg"
    frame_path.write_bytes(b"frame-bytes")

    uploader = R2FrameUploader()
    client = RecordingS3Client()
    uploader._client = client

    url = uploader.upload_frame_sync("video-123", 7, frame_path)

    assert url == "https://cdn.cerul.ai/frames/video-123/007.jpg"
    assert client.put_calls[0]["Bucket"] == "cerul-cdn"
    assert client.put_calls[0]["Key"] == "frames/video-123/007.jpg"
    assert client.put_calls[0]["ContentType"] == "image/jpeg"


def test_r2_frame_uploader_batch_skips_missing_files(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-123")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "access-123")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret-123")
    monkeypatch.setenv("R2_BUCKET_NAME", "cerul-cdn")
    monkeypatch.setenv("R2_PUBLIC_URL", "https://cdn.cerul.ai")
    reset_settings_cache()

    first_frame = tmp_path / "frame-001.jpg"
    first_frame.write_bytes(b"frame-1")
    missing_frame = tmp_path / "frame-002.jpg"

    uploader = R2FrameUploader()
    client = RecordingS3Client()
    uploader._client = client

    uploaded = run_async(
        uploader.upload_frames_batch(
            "video-123",
            [(1, first_frame), (2, missing_frame)],
            max_concurrency=2,
        )
    )

    assert uploaded == {1: "https://cdn.cerul.ai/frames/video-123/001.jpg"}
    assert len(client.put_calls) == 1

