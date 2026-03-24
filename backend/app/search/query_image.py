from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

ALLOWED_MIME_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024


async def resolve_image_to_local(
    *,
    url: str | None = None,
    base64_str: str | None = None,
    file_bytes: bytes | None = None,
    file_content_type: str | None = None,
) -> tuple[Path, str]:
    if url:
        return await _download_image(url)
    if base64_str:
        return _decode_base64_image(base64_str)
    if file_bytes is not None:
        return _save_bytes_image(file_bytes, file_content_type)
    raise ValueError("No image input provided.")


async def upload_query_image_to_r2(
    image_path: Path,
    *,
    request_id: str,
) -> str | None:
    settings = get_settings().r2
    if not (
        settings.account_id
        and settings.access_key_id
        and settings.secret_access_key
        and settings.bucket_name
    ):
        return None

    try:
        key = await asyncio.to_thread(
            _upload_query_image_sync,
            image_path,
            request_id,
            settings.account_id,
            settings.access_key_id,
            settings.secret_access_key,
            settings.bucket_name,
        )
        return key
    except Exception as exc:  # pragma: no cover - best effort background task
        logger.warning("Failed to upload query image to R2: %s", exc)
        return None


def cleanup_local_image(image_path: Path) -> None:
    image_path.unlink(missing_ok=True)


async def _download_image(url: str) -> tuple[Path, str]:
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()

            content_type = _normalize_content_type(response.headers.get("content-type"))
            if content_type not in ALLOWED_MIME_TYPES:
                raise ValueError(f"Unsupported image type: {content_type or 'unknown'}")

            content_length = response.headers.get("content-length")
            if content_length:
                try:
                    parsed_content_length = int(content_length)
                except ValueError:
                    parsed_content_length = None
                if parsed_content_length is not None and parsed_content_length > MAX_IMAGE_SIZE_BYTES:
                    raise ValueError(
                        f"Image too large: {parsed_content_length} bytes (max {MAX_IMAGE_SIZE_BYTES})"
                    )

            payload = bytearray()
            async for chunk in response.aiter_bytes():
                payload.extend(chunk)
                if len(payload) > MAX_IMAGE_SIZE_BYTES:
                    raise ValueError(
                        f"Image too large: {len(payload)} bytes (max {MAX_IMAGE_SIZE_BYTES})"
                    )

    return _write_temp_image(bytes(payload), content_type)


def _decode_base64_image(base64_str: str) -> tuple[Path, str]:
    mime_type = "image/jpeg"
    payload = base64_str.strip()

    if payload.startswith("data:"):
        header, separator, remainder = payload.partition(",")
        if not separator:
            raise ValueError("Invalid data URI image payload.")
        mime_type = _normalize_content_type(header.split(";", 1)[0].replace("data:", ""))
        if mime_type not in ALLOWED_MIME_TYPES:
            raise ValueError(f"Unsupported image type: {mime_type or 'unknown'}")
        payload = remainder

    try:
        raw_bytes = base64.b64decode(payload, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Invalid base64 image payload.") from exc

    _validate_image_size(raw_bytes)
    return _write_temp_image(raw_bytes, mime_type)


def _save_bytes_image(
    file_bytes: bytes,
    content_type: str | None,
) -> tuple[Path, str]:
    mime_type = _normalize_content_type(content_type) or "image/jpeg"
    if mime_type not in ALLOWED_MIME_TYPES:
        raise ValueError(f"Unsupported image type: {mime_type}")

    _validate_image_size(file_bytes)
    return _write_temp_image(file_bytes, mime_type)


def _write_temp_image(payload: bytes, mime_type: str) -> tuple[Path, str]:
    suffix = ALLOWED_MIME_TYPES.get(mime_type, ".jpg")
    handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        handle.write(payload)
    finally:
        handle.close()
    return Path(handle.name), mime_type


def _upload_query_image_sync(
    image_path: Path,
    request_id: str,
    account_id: str,
    access_key_id: str,
    secret_access_key: str,
    bucket_name: str,
) -> str:
    import boto3

    payload = image_path.read_bytes()
    sha256 = hashlib.sha256(payload).hexdigest()
    suffix = image_path.suffix.lower() or ".jpg"
    current_date = datetime.now(timezone.utc).date().isoformat()
    key = f"query-inputs/{current_date}/{request_id}/{sha256}{suffix}"

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name="auto",
    )
    client.put_object(
        Bucket=bucket_name,
        Key=key,
        Body=payload,
        ContentType=_guess_content_type(image_path),
        CacheControl="private, max-age=0, no-store",
    )
    return key


def _guess_content_type(image_path: Path) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }.get(image_path.suffix.lower(), "image/jpeg")


def _normalize_content_type(value: str | None) -> str:
    return (value or "").split(";", 1)[0].strip().lower()


def _validate_image_size(payload: bytes) -> None:
    if len(payload) > MAX_IMAGE_SIZE_BYTES:
        raise ValueError(
            f"Image too large: {len(payload)} bytes (max {MAX_IMAGE_SIZE_BYTES})"
        )
