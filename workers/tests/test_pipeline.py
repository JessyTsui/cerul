import asyncio

from workers.common.pipeline import PipelineContext, PipelineExecutor, PipelineStep


class RecordingStep(PipelineStep):
    def __init__(self, label: str, callback=None) -> None:
        self._label = label
        self._callback = callback

    @property
    def name(self) -> str:
        return self._label

    async def _process(self, context: PipelineContext) -> None:
        context.data.setdefault("order", []).append(self._label)
        if self._callback is not None:
            await self._callback(context)


class BrokenStep(PipelineStep):
    @property
    def name(self) -> str:
        return "broken"

    async def _process(self, context: PipelineContext) -> None:
        raise RuntimeError("boom")


class SlowStep(PipelineStep):
    @property
    def name(self) -> str:
        return "slow"

    async def _process(self, context: PipelineContext) -> None:
        await asyncio.sleep(0.05)


def test_pipeline_executor_runs_steps_in_order() -> None:
    executor = PipelineExecutor(
        [RecordingStep("first"), RecordingStep("second"), RecordingStep("third")]
    )

    context = asyncio.run(executor.run(PipelineContext()))

    assert context.data["order"] == ["first", "second", "third"]
    assert context.completed_steps == ["first", "second", "third"]
    assert context.failed_step is None


def test_pipeline_executor_skips_one_step() -> None:
    async def skip_next(context: PipelineContext) -> None:
        context.request_skip_current_step()

    executor = PipelineExecutor(
        [
            RecordingStep("first", callback=skip_next),
            RecordingStep("second"),
            RecordingStep("third"),
        ]
    )

    context = asyncio.run(executor.run(PipelineContext()))

    assert context.data["order"] == ["first", "third"]
    assert context.skipped_steps == ["second"]
    assert context.completed_steps == ["first", "third"]


def test_pipeline_executor_skips_all_following_steps() -> None:
    async def stop_pipeline(context: PipelineContext) -> None:
        context.request_skip_all_following_steps()

    executor = PipelineExecutor(
        [
            RecordingStep("first", callback=stop_pipeline),
            RecordingStep("second"),
            RecordingStep("third"),
        ]
    )

    context = asyncio.run(executor.run(PipelineContext()))

    assert context.data["order"] == ["first"]
    assert context.skipped_steps == ["second", "third"]
    assert context.completed_steps == ["first"]


def test_pipeline_executor_records_failed_step() -> None:
    executor = PipelineExecutor([RecordingStep("first"), BrokenStep(), RecordingStep("third")])

    context = asyncio.run(executor.run(PipelineContext()))

    assert context.data["order"] == ["first"]
    assert context.failed_step == "broken"
    assert context.error == "boom"
    assert context.completed_steps == ["first"]


def test_pipeline_executor_emits_progress_callback_events() -> None:
    events: list[tuple[str, str]] = []

    async def progress_callback(step_name: str, status: str, context: PipelineContext) -> None:
        events.append((step_name, status))

    executor = PipelineExecutor([RecordingStep("first"), BrokenStep()])

    context = asyncio.run(
        executor.run(
            PipelineContext(
                conf={"progress_callback": progress_callback},
            )
        )
    )

    assert context.failed_step == "broken"
    assert events == [
        ("first", "running"),
        ("first", "completed"),
        ("broken", "running"),
        ("broken", "failed"),
    ]


def test_pipeline_executor_times_out_step_with_guidance_and_logs() -> None:
    logs: list[tuple[str, str, str]] = []

    async def step_log_callback(
        step_name: str,
        level: str,
        message: str,
        details: dict[str, object],
        context: PipelineContext,
    ) -> None:
        logs.append((step_name, level, message))

    executor = PipelineExecutor([SlowStep()])

    context = asyncio.run(
        executor.run(
            PipelineContext(
                conf={
                    "step_timeouts": {"slow": 0.01},
                    "step_timeout_guidance": {"slow": "Check the upstream provider."},
                    "step_log_callback": step_log_callback,
                }
            )
        )
    )

    assert context.failed_step == "slow"
    assert context.error == "Step slow timed out after 0.0s. Check the upstream provider."
    assert context.data["step_duration_ms"]["slow"] >= 0
    assert context.data["step_timeout_seconds"]["slow"] == 0.01
    assert context.data["step_guidance"]["slow"] == context.error
    assert logs[0][0:2] == ("slow", "info")
    assert logs[-1][0:2] == ("slow", "error")
