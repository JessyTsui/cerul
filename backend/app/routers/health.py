from datetime import datetime, timezone

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/healthz")
def read_health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "cerul-api",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
