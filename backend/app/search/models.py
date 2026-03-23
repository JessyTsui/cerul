from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class UnifiedFilters(StrictModel):
    speaker: str | None = None
    published_after: date | None = None
    min_duration: int | None = Field(default=None, ge=0)
    max_duration: int | None = Field(default=None, ge=0)
    source: str | None = None

    @model_validator(mode="after")
    def validate_range(self) -> "UnifiedFilters":
        if (
            self.min_duration is not None
            and self.max_duration is not None
            and self.min_duration > self.max_duration
        ):
            raise ValueError("min_duration must be less than or equal to max_duration")
        return self


class BrollFilters(UnifiedFilters):
    pass


class KnowledgeFilters(UnifiedFilters):
    pass


class SearchImageInput(StrictModel):
    url: AnyHttpUrl | None = None
    base64: str | None = None

    @model_validator(mode="after")
    def validate_single_source(self) -> "SearchImageInput":
        if self.url is not None and self.base64 is not None:
            raise ValueError("Provide either 'url' or 'base64', not both.")
        if self.url is None and self.base64 is None:
            raise ValueError("Provide 'url' or 'base64'.")
        return self


class SearchRequest(StrictModel):
    query: str | None = Field(default=None, min_length=1)
    image: SearchImageInput | None = None
    max_results: int = Field(default=10, ge=1, le=50)
    ranking_mode: Literal["embedding", "rerank"] = "embedding"
    include_summary: bool = False
    include_answer: bool = False
    filters: UnifiedFilters | None = None

    @model_validator(mode="before")
    @classmethod
    def coerce_filters(cls, values: object) -> object:
        if not isinstance(values, dict):
            return values

        filters = values.get("filters")
        if filters is None or not isinstance(filters, dict):
            return values

        updated_values = dict(values)
        updated_values["filters"] = UnifiedFilters.model_validate(filters)
        return updated_values

    @model_validator(mode="after")
    def validate_filters(self) -> "SearchRequest":
        normalized_query = (self.query or "").strip()
        if not normalized_query and self.image is None:
            raise ValueError("At least one of 'query' or 'image' must be provided.")
        return self


class SearchResult(StrictModel):
    id: str
    score: float = Field(ge=0.0, le=1.0)
    rerank_score: float | None = Field(default=None, ge=0.0, le=1.0)
    url: AnyHttpUrl
    title: str
    snippet: str
    thumbnail_url: AnyHttpUrl | None = None
    keyframe_url: AnyHttpUrl | None = None
    duration: int = Field(ge=0)
    source: str
    speaker: str | None = None
    timestamp_start: float | None = Field(default=None, ge=0.0)
    timestamp_end: float | None = Field(default=None, ge=0.0)
    unit_type: Literal["summary", "speech", "visual"]

    @model_validator(mode="after")
    def validate_timestamps(self) -> "SearchResult":
        if (
            self.timestamp_start is not None
            and self.timestamp_end is not None
            and self.timestamp_end < self.timestamp_start
        ):
            raise ValueError("timestamp_end must be greater than or equal to timestamp_start")
        return self


class SearchResponse(StrictModel):
    results: list[SearchResult]
    answer: str | None = None
    credits_used: int = Field(ge=0)
    credits_remaining: int = Field(ge=0)
    request_id: str = Field(pattern=r"^req_[a-f0-9]{24}$")


KnowledgeResult = SearchResult


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
