import pytest

from app.middleware.rate_limit import InMemoryTokenBucketRateLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.mark.anyio
async def test_token_bucket_rejects_requests_over_limit() -> None:
    clock = FakeClock()
    limiter = InMemoryTokenBucketRateLimiter(clock=clock)

    first = await limiter.acquire("key-1", 1)
    second = await limiter.acquire("key-1", 1)

    assert first.allowed is True
    assert first.remaining == 0
    assert second.allowed is False
    assert second.remaining == 0
    assert second.retry_after_seconds == pytest.approx(1.0)


@pytest.mark.anyio
async def test_token_bucket_refills_after_one_second() -> None:
    clock = FakeClock()
    limiter = InMemoryTokenBucketRateLimiter(clock=clock)

    await limiter.acquire("key-1", 1)
    denied = await limiter.acquire("key-1", 1)
    clock.advance(1.0)
    allowed = await limiter.acquire("key-1", 1)

    assert denied.allowed is False
    assert allowed.allowed is True


@pytest.mark.anyio
async def test_token_bucket_keeps_api_keys_isolated() -> None:
    clock = FakeClock()
    limiter = InMemoryTokenBucketRateLimiter(clock=clock)

    await limiter.acquire("key-1", 1)
    denied = await limiter.acquire("key-1", 1)
    allowed = await limiter.acquire("key-2", 1)

    assert denied.allowed is False
    assert allowed.allowed is True
