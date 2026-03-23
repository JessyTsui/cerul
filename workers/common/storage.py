from __future__ import annotations

import asyncio
from pathlib import Path

from backend.app.config import get_settings

DEFAULT_R2_CONCURRENCY = 10


class R2FrameUploader:
    def __init__(self) -> None:
        settings = get_settings().r2
        self._account_id = settings.account_id
        self._access_key_id = settings.access_key_id
        self._secret_access_key = settings.secret_access_key
        self._bucket_name = settings.bucket_name
        self._public_url = settings.public_url.rstrip("/")
        self._client = None

    def available(self) -> bool:
        return bool(
            self._account_id
            and self._access_key_id
            and self._secret_access_key
            and self._bucket_name
            and self._public_url
        )

    def public_url_for_key(self, key: str) -> str:
        normalized_key = key.lstrip("/")
        if not self._public_url:
            raise RuntimeError("R2 public URL is not configured.")
        return f"{self._public_url}/{normalized_key}"

    def _get_client(self):
        if self._client is None:
            import boto3

            self._client = boto3.client(
                "s3",
                endpoint_url=f"https://{self._account_id}.r2.cloudflarestorage.com",
                aws_access_key_id=self._access_key_id,
                aws_secret_access_key=self._secret_access_key,
                region_name="auto",
            )
        return self._client

    def upload_frame_sync(self, video_id: str, frame_index: int, frame_path: Path) -> str:
        key = f"frames/{video_id}/{frame_index:03d}.jpg"
        client = self._get_client()
        with frame_path.open("rb") as handle:
            client.put_object(
                Bucket=self._bucket_name,
                Key=key,
                Body=handle,
                ContentType="image/jpeg",
                CacheControl="public, max-age=31536000",
            )
        return self.public_url_for_key(key)

    async def upload_frame(self, video_id: str, frame_index: int, frame_path: Path) -> str:
        return await asyncio.to_thread(
            self.upload_frame_sync,
            video_id,
            frame_index,
            frame_path,
        )

    async def upload_frames_batch(
        self,
        video_id: str,
        frame_entries: list[tuple[int, Path]],
        max_concurrency: int = DEFAULT_R2_CONCURRENCY,
    ) -> dict[int, str]:
        if not self.available() or not frame_entries:
            return {}

        semaphore = asyncio.Semaphore(max(1, int(max_concurrency)))
        results: dict[int, str] = {}

        async def upload_one(frame_index: int, frame_path: Path) -> None:
            async with semaphore:
                if not frame_path.exists():
                    return
                results[frame_index] = await self.upload_frame(
                    video_id,
                    frame_index,
                    frame_path,
                )

        await asyncio.gather(
            *(upload_one(frame_index, frame_path) for frame_index, frame_path in frame_entries),
            return_exceptions=True,
        )
        return results
