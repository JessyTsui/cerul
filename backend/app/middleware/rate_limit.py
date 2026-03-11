from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from time import monotonic
from typing import Protocol


@dataclass(frozen=True, slots=True)
class RateLimitLease:
    allowed: bool
    limit: int
    remaining: int | None
    retry_after_seconds: float = 0.0


class RateLimiter(Protocol):
    async def acquire(self, bucket_id: str, rate_limit_per_sec: int) -> RateLimitLease:
        ...


@dataclass(slots=True)
class _BucketState:
    tokens: float
    updated_at: float


class InMemoryTokenBucketRateLimiter:
    def __init__(self, *, clock: Callable[[], float] = monotonic) -> None:
        self._clock = clock
        self._buckets: dict[str, _BucketState] = {}
        self._lock = asyncio.Lock()

    async def acquire(self, bucket_id: str, rate_limit_per_sec: int) -> RateLimitLease:
        if rate_limit_per_sec <= 0:
            return RateLimitLease(
                allowed=True,
                limit=rate_limit_per_sec,
                remaining=None,
            )

        async with self._lock:
            now = self._clock()
            refill_rate = float(rate_limit_per_sec)
            state = self._buckets.get(bucket_id)

            if state is None:
                state = _BucketState(tokens=refill_rate, updated_at=now)
                self._buckets[bucket_id] = state
            else:
                elapsed = max(now - state.updated_at, 0.0)
                state.tokens = min(refill_rate, state.tokens + (elapsed * refill_rate))
                state.updated_at = now

            if state.tokens >= 1.0:
                state.tokens -= 1.0
                return RateLimitLease(
                    allowed=True,
                    limit=rate_limit_per_sec,
                    remaining=max(int(state.tokens), 0),
                )

            retry_after_seconds = (1.0 - state.tokens) / refill_rate
            return RateLimitLease(
                allowed=False,
                limit=rate_limit_per_sec,
                remaining=0,
                retry_after_seconds=retry_after_seconds,
            )


_rate_limiter: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    global _rate_limiter

    if _rate_limiter is None:
        _rate_limiter = InMemoryTokenBucketRateLimiter()

    return _rate_limiter


def reset_rate_limiter() -> None:
    global _rate_limiter
    _rate_limiter = None
