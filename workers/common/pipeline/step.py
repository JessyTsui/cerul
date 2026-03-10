from abc import ABC, abstractmethod

from .context import PipelineContext


class PipelineStep(ABC):
    step_name: str | None = None

    @property
    def name(self) -> str:
        return self.step_name or type(self).__name__

    async def run(self, context: PipelineContext) -> PipelineContext:
        await self._preprocess(context)
        await self._process(context)
        await self._postprocess(context)
        return context

    async def _preprocess(self, context: PipelineContext) -> None:
        return None

    @abstractmethod
    async def _process(self, context: PipelineContext) -> None:
        raise NotImplementedError

    async def _postprocess(self, context: PipelineContext) -> None:
        return None
