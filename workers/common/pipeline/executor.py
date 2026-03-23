import asyncio
import inspect
import logging
import time
from collections.abc import Sequence
from collections.abc import Mapping

from .context import PipelineContext
from .step import PipelineStep


class PipelineExecutor:
    def __init__(
        self,
        steps: Sequence[PipelineStep],
        logger: logging.Logger | None = None,
    ) -> None:
        self._steps = list(steps)
        self._logger = logger or logging.getLogger(__name__)

    async def run(self, context: PipelineContext) -> PipelineContext:
        for index, step in enumerate(self._steps):
            if context.skip_all_following_steps:
                for pending_step in self._steps[index:]:
                    context.skipped_steps.append(pending_step.name)
                    await self._emit_progress(
                        context,
                        step_name=pending_step.name,
                        status="skipped",
                    )
                    self._logger.info(
                        "Skipping step %s because remaining execution was cancelled.",
                        pending_step.name,
                    )
                break

            if context.skip_current_step:
                context.skipped_steps.append(step.name)
                context.skip_current_step = False
                await self._emit_progress(
                    context,
                    step_name=step.name,
                    status="skipped",
                )
                self._logger.info(
                    "Skipping step %s because skip_current_step was requested.",
                    step.name,
                )
                continue

            context.current_step = step.name
            timeout_seconds = self._resolve_step_timeout_seconds(context, step.name)
            await self._emit_progress(
                context,
                step_name=step.name,
                status="running",
            )
            await self._emit_step_log(
                context,
                step_name=step.name,
                level="info",
                message=(
                    f"Started step {step.name}."
                    + (
                        f" Timeout set to {self._format_timeout_seconds(timeout_seconds)}."
                        if timeout_seconds
                        else ""
                    )
                ),
                details={"timeout_seconds": timeout_seconds} if timeout_seconds else None,
            )
            self._logger.info("Starting step %s.", step.name)
            step_started_at = time.monotonic()

            try:
                if timeout_seconds:
                    await asyncio.wait_for(step.run(context), timeout=timeout_seconds)
                else:
                    await step.run(context)
            except asyncio.TimeoutError:
                context.failed_step = step.name
                context.error = self._build_timeout_error(context, step.name, timeout_seconds)
                self._remember_step_telemetry(
                    context,
                    step_name=step.name,
                    duration_ms=self._duration_ms(step_started_at),
                    timeout_seconds=timeout_seconds,
                    guidance=context.error,
                )
                await self._emit_step_log(
                    context,
                    step_name=step.name,
                    level="error",
                    message=context.error,
                    details={"timeout_seconds": timeout_seconds},
                )
                await self._emit_progress(
                    context,
                    step_name=step.name,
                    status="failed",
                )
                self._logger.error(
                    "Step %s timed out after %s.",
                    step.name,
                    self._format_timeout_seconds(timeout_seconds),
                )
                break
            except Exception as exc:
                context.failed_step = step.name
                context.error = str(exc)
                self._remember_step_telemetry(
                    context,
                    step_name=step.name,
                    duration_ms=self._duration_ms(step_started_at),
                )
                await self._emit_step_log(
                    context,
                    step_name=step.name,
                    level="error",
                    message=f"Step failed: {exc}",
                    details={"duration_ms": self._duration_ms(step_started_at)},
                )
                await self._emit_progress(
                    context,
                    step_name=step.name,
                    status="failed",
                )
                self._logger.exception("Step %s failed.", step.name)
                break

            context.completed_steps.append(step.name)
            duration_ms = self._duration_ms(step_started_at)
            self._remember_step_telemetry(
                context,
                step_name=step.name,
                duration_ms=duration_ms,
                timeout_seconds=timeout_seconds,
            )
            await self._emit_step_log(
                context,
                step_name=step.name,
                level="info",
                message=f"Completed step {step.name} in {self._format_duration_ms(duration_ms)}.",
                details={"duration_ms": duration_ms},
            )
            await self._emit_progress(
                context,
                step_name=step.name,
                status="completed",
            )
            self._logger.info("Finished step %s.", step.name)

        return context

    async def _emit_progress(
        self,
        context: PipelineContext,
        *,
        step_name: str,
        status: str,
    ) -> None:
        callback = context.conf.get("progress_callback")
        if not callable(callback):
            return

        try:
            result = callback(step_name, status, context)
            if inspect.isawaitable(result):
                await result
        except Exception:
            self._logger.warning(
                "Progress callback failed for step %s with status %s.",
                step_name,
                status,
                exc_info=True,
            )

    async def _emit_step_log(
        self,
        context: PipelineContext,
        *,
        step_name: str,
        level: str,
        message: str,
        details: Mapping[str, object] | None = None,
    ) -> None:
        callback = context.conf.get("step_log_callback")
        if not callable(callback):
            return

        try:
            result = callback(step_name, level, message, dict(details or {}), context)
            if inspect.isawaitable(result):
                await result
        except Exception:
            self._logger.warning(
                "Step log callback failed for step %s.",
                step_name,
                exc_info=True,
            )

    def _resolve_step_timeout_seconds(
        self,
        context: PipelineContext,
        step_name: str,
    ) -> float | None:
        raw_timeouts = context.conf.get("step_timeouts")
        if not isinstance(raw_timeouts, Mapping):
            return None

        raw_value = raw_timeouts.get(step_name)
        if raw_value in (None, "", 0, 0.0):
            return None

        try:
            timeout_seconds = float(raw_value)
        except (TypeError, ValueError):
            return None

        return timeout_seconds if timeout_seconds > 0 else None

    def _build_timeout_error(
        self,
        context: PipelineContext,
        step_name: str,
        timeout_seconds: float | None,
    ) -> str:
        guidance_map = context.conf.get("step_timeout_guidance")
        guidance = None
        if isinstance(guidance_map, Mapping):
            raw_guidance = guidance_map.get(step_name)
            if raw_guidance is not None:
                guidance = str(raw_guidance).strip() or None

        timeout_fragment = (
            f" after {self._format_timeout_seconds(timeout_seconds)}"
            if timeout_seconds
            else ""
        )
        message = f"Step {step_name} timed out{timeout_fragment}."
        if guidance:
            message = f"{message} {guidance}"
        return message

    def _remember_step_telemetry(
        self,
        context: PipelineContext,
        *,
        step_name: str,
        duration_ms: int,
        timeout_seconds: float | None = None,
        guidance: str | None = None,
    ) -> None:
        durations = context.data.setdefault("step_duration_ms", {})
        durations[step_name] = duration_ms

        if timeout_seconds:
            timeout_map = context.data.setdefault("step_timeout_seconds", {})
            timeout_map[step_name] = timeout_seconds

        if guidance:
            guidance_map = context.data.setdefault("step_guidance", {})
            guidance_map[step_name] = guidance

    def _duration_ms(self, started_at_monotonic: float) -> int:
        return max(int(round((time.monotonic() - started_at_monotonic) * 1000)), 0)

    def _format_timeout_seconds(self, value: float | None) -> str:
        if value is None:
            return "0s"
        if value >= 60 and float(value).is_integer():
            minutes = int(value) // 60
            seconds = int(value) % 60
            return f"{minutes}m" if seconds == 0 else f"{minutes}m {seconds}s"
        if float(value).is_integer():
            return f"{int(value)}s"
        return f"{value:.1f}s"

    def _format_duration_ms(self, value: int) -> str:
        total_seconds = max(int(round(value / 1000.0)), 0)
        minutes, seconds = divmod(total_seconds, 60)
        hours, minutes = divmod(minutes, 60)
        if hours > 0:
            return f"{hours}h {minutes}m {seconds}s"
        if minutes > 0:
            return f"{minutes}m {seconds}s"
        return f"{seconds}s"
