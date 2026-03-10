from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class BrollFilters(StrictModel):
    min_duration: int | None = Field(default=None, ge=0)
    max_duration: int | None = Field(default=None, ge=0)
    source: Literal["pexels", "pixabay"] | None = None

    @model_validator(mode="after")
    def validate_range(self) -> "BrollFilters":
        if (
            self.min_duration is not None
            and self.max_duration is not None
            and self.min_duration > self.max_duration
        ):
            raise ValueError("min_duration must be less than or equal to max_duration")
        return self


class KnowledgeFilters(StrictModel):
    speaker: str | None = None
    published_after: date | None = None


class SearchRequest(StrictModel):
    query: str = Field(min_length=1)
    search_type: Literal["broll", "knowledge"]
    max_results: int = Field(default=10, ge=1, le=50)
    include_answer: bool = False
    filters: BrollFilters | KnowledgeFilters | None = None

    @model_validator(mode="before")
    @classmethod
    def coerce_filters(cls, values: object) -> object:
        if not isinstance(values, dict):
            return values

        filters = values.get("filters")
        search_type = values.get("search_type")
        if filters is None or not isinstance(filters, dict):
            return values

        updated_values = dict(values)
        if search_type == "broll":
            updated_values["filters"] = BrollFilters.model_validate(filters)
        elif search_type == "knowledge":
            updated_values["filters"] = KnowledgeFilters.model_validate(filters)
        return updated_values

    @model_validator(mode="after")
    def validate_filters(self) -> "SearchRequest":
        if not self.query.strip():
            raise ValueError("query must not be empty")

        if self.search_type == "broll":
            if self.include_answer:
                raise ValueError("include_answer is only supported for knowledge searches")
            if self.filters is not None and not isinstance(self.filters, BrollFilters):
                raise ValueError("broll searches only accept BrollFilters")
        else:
            if self.filters is not None and not isinstance(self.filters, KnowledgeFilters):
                raise ValueError("knowledge searches only accept KnowledgeFilters")

        return self


class SearchResult(StrictModel):
    id: str
    score: float = Field(ge=0.0, le=1.0)
    title: str
    description: str
    video_url: AnyHttpUrl
    thumbnail_url: AnyHttpUrl
    duration: int = Field(ge=0)
    source: str
    license: str


class KnowledgeResult(SearchResult):
    timestamp_start: float = Field(ge=0.0)
    timestamp_end: float = Field(ge=0.0)
    answer: str | None = None

    @model_validator(mode="after")
    def validate_timestamps(self) -> "KnowledgeResult":
        if self.timestamp_end < self.timestamp_start:
            raise ValueError("timestamp_end must be greater than or equal to timestamp_start")
        return self


class SearchResponse(StrictModel):
    results: list[SearchResult | KnowledgeResult]
    credits_used: int = Field(ge=0)
    credits_remaining: int = Field(ge=0)
    request_id: str = Field(pattern=r"^req_[a-f0-9]{24}$")


class UsageResponse(StrictModel):
    tier: str
    period_start: date
    period_end: date
    credits_limit: int = Field(ge=0)
    credits_used: int = Field(ge=0)
    credits_remaining: int = Field(ge=0)
    rate_limit_per_sec: int = Field(ge=0)
    api_keys_active: int = Field(ge=0)


class ErrorDetail(StrictModel):
    code: str
    message: str


class ErrorResponse(StrictModel):
    error: ErrorDetail
