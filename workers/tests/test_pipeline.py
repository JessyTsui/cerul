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
