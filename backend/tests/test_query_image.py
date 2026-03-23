from __future__ import annotations

import asyncio

import pytest

from app.search import query_image


class _FakeStreamResponse:
    def __init__(self, *, headers: dict[str, str], chunks: list[bytes]) -> None:
        self.headers = headers
        self._chunks = chunks

    async def __aenter__(self) -> _FakeStreamResponse:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def raise_for_status(self) -> None:
        return None

    async def aiter_bytes(self):
        for chunk in self._chunks:
            yield chunk


class _FakeAsyncClient:
    def __init__(self, response: _FakeStreamResponse, *args, **kwargs) -> None:
        self._response = response

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def stream(self, method: str, url: str) -> _FakeStreamResponse:
        assert method == "GET"
        assert url.startswith("https://")
        return self._response


def test_resolve_image_to_local_rejects_large_remote_image_by_content_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _FakeStreamResponse(
        headers={
            "content-type": "image/jpeg",
            "content-length": str(query_image.MAX_IMAGE_SIZE_BYTES + 1),
        },
        chunks=[b"small"],
    )
    monkeypatch.setattr(
        query_image.httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(response, *args, **kwargs),
    )

    with pytest.raises(ValueError, match="Image too large"):
        asyncio.run(query_image.resolve_image_to_local(url="https://example.com/large.jpg"))


def test_resolve_image_to_local_rejects_large_remote_image_while_streaming(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _FakeStreamResponse(
        headers={"content-type": "image/png"},
        chunks=[
            b"a" * (query_image.MAX_IMAGE_SIZE_BYTES // 2),
            b"b" * (query_image.MAX_IMAGE_SIZE_BYTES // 2 + 1),
        ],
    )
    monkeypatch.setattr(
        query_image.httpx,
        "AsyncClient",
        lambda *args, **kwargs: _FakeAsyncClient(response, *args, **kwargs),
    )

    with pytest.raises(ValueError, match="Image too large"):
        asyncio.run(query_image.resolve_image_to_local(url="https://example.com/chunked.png"))
