import logging
from collections.abc import Sequence

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
                    self._logger.info(
                        "Skipping step %s because remaining execution was cancelled.",
                        pending_step.name,
                    )
                break

            if context.skip_current_step:
                context.skipped_steps.append(step.name)
                context.skip_current_step = False
                self._logger.info(
                    "Skipping step %s because skip_current_step was requested.",
                    step.name,
                )
                continue

            context.current_step = step.name
            self._logger.info("Starting step %s.", step.name)

            try:
                await step.run(context)
            except Exception as exc:
                context.failed_step = step.name
                context.error = str(exc)
                self._logger.exception("Step %s failed.", step.name)
                break

            context.completed_steps.append(step.name)
            self._logger.info("Finished step %s.", step.name)

        return context
