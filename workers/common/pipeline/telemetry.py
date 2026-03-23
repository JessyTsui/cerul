from __future__ import annotations

import inspect
from collections.abc import Mapping
from typing import Any

from .context import PipelineContext


async def emit_step_log(
    context: PipelineContext,
    step_name: str,
    message: str,
    *,
    level: str = "info",
    details: Mapping[str, Any] | None = None,
) -> None:
    callback = context.conf.get("step_log_callback")
    if not callable(callback):
        return

    try:
        result = callback(
            step_name,
            level,
            message,
            dict(details or {}),
            context,
        )
        if inspect.isawaitable(result):
            await result
    except Exception:
        return
