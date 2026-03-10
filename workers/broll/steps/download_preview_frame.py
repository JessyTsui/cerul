import mimetypes
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from workers.common.pipeline import PipelineContext, PipelineStep


class DownloadPreviewFrameStep(PipelineStep):
    step_name = "DownloadPreviewFrameStep"

    def __init__(self, timeout: float = 30.0) -> None:
        self._timeout = timeout

    async def _process(self, context: PipelineContext) -> None:
        assets = context.data.get("assets", [])
        if not assets:
            context.data["frame_paths"] = {}
            return

        temp_dir_root = context.conf.get("temp_dir_root")
        temp_dir = Path(
            tempfile.mkdtemp(prefix="cerul-broll-", dir=temp_dir_root or None)
        )
        frame_paths: dict[str, str] = {}
        download_errors: dict[str, str] = {}

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for asset in assets:
                asset_id = asset["id"]
                image_url = asset.get("thumbnail_url")
                if not image_url:
                    download_errors[asset_id] = "Missing thumbnail_url."
                    continue

                try:
                    response = await client.get(image_url)
                    response.raise_for_status()
                except httpx.HTTPError as exc:
                    download_errors[asset_id] = str(exc)
                    continue

                file_extension = self._guess_extension(
                    image_url=image_url,
                    content_type=response.headers.get("content-type"),
                )
                frame_path = temp_dir / f"{asset_id}{file_extension}"
                frame_path.write_bytes(response.content)
                frame_paths[asset_id] = str(frame_path)

        context.data["temp_dir"] = str(temp_dir)
        context.data["frame_paths"] = frame_paths
        if download_errors:
            context.data["frame_download_errors"] = download_errors

    def _guess_extension(self, image_url: str, content_type: str | None) -> str:
        suffix = Path(urlsplit(image_url).path).suffix
        if suffix:
            return suffix

        if content_type:
            guessed_extension = mimetypes.guess_extension(
                content_type.split(";", maxsplit=1)[0].strip()
            )
            if guessed_extension:
                return guessed_extension

        return ".jpg"
