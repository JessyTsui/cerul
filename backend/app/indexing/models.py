from __future__ import annotations

from datetime import datetime

from pydantic import ConfigDict, Field

from app.search.models import StrictModel


class IndexRequest(StrictModel):
    url: str = Field(min_length=1)
    force: bool = False


class SubmitIndexResponse(StrictModel):
    video_id: str
    status: str
    request_id: str


class IndexStatusResponse(StrictModel):
    video_id: str
    status: str
    title: str | None = None
    current_step: str | None = None
    steps_completed: int | None = Field(default=None, ge=0)
    steps_total: int | None = Field(default=None, ge=0)
    duration: int | None = Field(default=None, ge=0)
    units_created: int | None = Field(default=None, ge=0)
    error: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
    failed_at: datetime | None = None


class IndexListItem(StrictModel):
    video_id: str
    title: str
    status: str
    units_created: int = Field(ge=0)
    created_at: datetime
    completed_at: datetime | None = None


class IndexListResponse(StrictModel):
    videos: list[IndexListItem]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    per_page: int = Field(ge=1)


class DeleteIndexResponse(StrictModel):
    deleted: bool
