from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class PipelineContext:
    conf: dict[str, Any] = field(default_factory=dict)
    data: dict[str, Any] = field(default_factory=dict)
    skip_current_step: bool = False
    skip_all_following_steps: bool = False
    current_step: str | None = None
    completed_steps: list[str] = field(default_factory=list)
    skipped_steps: list[str] = field(default_factory=list)
    failed_step: str | None = None
    error: str | None = None

    def request_skip_current_step(self) -> None:
        self.skip_current_step = True

    def request_skip_all_following_steps(self) -> None:
        self.skip_all_following_steps = True
