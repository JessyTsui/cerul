from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)
import yaml


_CONFIG_ENV_PREFIX = "CERUL__"
_LEGACY_ENV_OVERRIDES: dict[str, tuple[str, ...]] = {
    "ADMIN_CONSOLE_EMAILS": ("dashboard", "admin_emails"),
    "DATABASE_URL": ("database", "url"),
    "EMBEDDING_BACKEND": ("embedding", "backend"),
    "EMBEDDING_MODEL": ("embedding", "model"),
    "EMBEDDING_DIMENSION": ("embedding", "dimension"),
    "EMBEDDING_NORMALIZE": ("embedding", "normalize"),
    "MMR_LAMBDA": ("search", "mmr_lambda"),
    "API_BASE_URL": ("public", "api_base_url"),
    "WEB_BASE_URL": ("public", "web_base_url"),
    "NEXT_PUBLIC_API_BASE_URL": ("public", "api_base_url"),
    "NEXT_PUBLIC_SITE_URL": ("public", "web_base_url"),
    "DEMO_MODE": ("public", "demo_mode"),
    "RERANK_MODEL": ("knowledge", "rerank_model"),
    "STRIPE_PRO_PRICE_ID": ("stripe", "pro_price_id"),
    "STRIPE_SECRET_KEY": ("stripe", "secret_key"),
    "STRIPE_WEBHOOK_SECRET": ("stripe", "webhook_secret"),
    "OPENAI_TRANSCRIBE_BASE_URL": ("knowledge", "transcription", "base_url"),
    "OPENAI_TRANSCRIBE_MODEL": ("knowledge", "transcription", "model"),
    "OPENAI_TRANSCRIBE_RESPONSE_FORMAT": ("knowledge", "transcription", "response_format"),
    "OPENAI_TRANSCRIBE_TIMEOUT_SECONDS": ("knowledge", "transcription", "timeout_seconds"),
    "OPENAI_TRANSCRIBE_TIMESTAMP_GRANULARITY": (
        "knowledge",
        "transcription",
        "timestamp_granularity",
    ),
    "ASR_BASE_URL": ("knowledge", "transcription", "base_url"),
    "ASR_MODEL": ("knowledge", "transcription", "model"),
    "ASR_RESPONSE_FORMAT": ("knowledge", "transcription", "response_format"),
    "ASR_TIMEOUT_SECONDS": ("knowledge", "transcription", "timeout_seconds"),
    "ASR_TIMESTAMP_GRANULARITY": (
        "knowledge",
        "transcription",
        "timestamp_granularity",
    ),
    "R2_ACCOUNT_ID": ("r2", "account_id"),
    "R2_ACCESS_KEY_ID": ("r2", "access_key_id"),
    "R2_SECRET_ACCESS_KEY": ("r2", "secret_access_key"),
    "R2_BUCKET_NAME": ("r2", "bucket_name"),
    "R2_PUBLIC_URL": ("r2", "public_url"),
}

_SETTINGS_CACHE: Settings | None = None
_SETTINGS_CACHE_KEY: tuple[str, tuple[tuple[str, str], ...]] | None = None


class PublicSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    app_env: str = "development"
    api_base_url: str = "http://localhost:8000"
    web_base_url: str = "http://localhost:3000"
    demo_mode: bool = False
    default_track: str
    enabled_tracks: list[str]

    @model_validator(mode="after")
    def validate_default_track(self) -> "PublicSettings":
        if self.default_track not in self.enabled_tracks:
            raise ValueError("public.default_track must be listed in public.enabled_tracks")
        return self


class SearchSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mmr_lambda: float = Field(ge=0.0, le=1.0)
    clip_score_threshold: float | None = None


class EmbeddingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    backend: str = "gemini"
    model: str = "gemini-embedding-2-preview"
    dimension: int = Field(default=3072, ge=128, le=3072)
    normalize: bool = True

    @field_validator("backend", mode="before")
    @classmethod
    def normalize_backend(cls, value: Any) -> str:
        cleaned = str(value or "gemini").strip().lower()
        if cleaned not in {"gemini", "openai_compatible"}:
            raise ValueError("embedding.backend must be 'gemini' or 'openai_compatible'")
        return cleaned


class KnowledgeTranscriptionSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str = "openai_compatible"
    base_url: str = "https://api.openai.com/v1"
    model: str = "whisper-1"
    response_format: str = "auto"
    timeout_seconds: float = Field(default=600.0, gt=0.0)
    timestamp_granularity: str = "segment"


class KnowledgeDownloadSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_height: int = Field(default=480, gt=0)


class KnowledgeSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_threshold: float = Field(ge=0.0, le=1.0)
    dense_visual_frames_per_segment: int = Field(default=3, ge=0, le=16)
    rerank_top_n: int = Field(gt=0)
    rerank_prompt_template: str
    rerank_model: str = "gpt-4o-mini"
    download: KnowledgeDownloadSettings = Field(
        default_factory=KnowledgeDownloadSettings
    )
    transcription: KnowledgeTranscriptionSettings = Field(
        default_factory=KnowledgeTranscriptionSettings
    )


class DatabaseSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str | None = None


class R2Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    account_id: str = ""
    access_key_id: str = ""
    secret_access_key: str = ""
    bucket_name: str = "cerul-cdn"
    public_url: str = ""

    @field_validator("account_id", "access_key_id", "secret_access_key", "bucket_name", "public_url", mode="before")
    @classmethod
    def normalize_string(cls, value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()

    @model_validator(mode="after")
    def normalize_public_url(self) -> "R2Settings":
        self.public_url = self.public_url.rstrip("/")
        return self


class StripeSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    secret_key: str | None = None
    webhook_secret: str | None = None
    pro_price_id: str | None = None


class DashboardSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    admin_emails: list[str] = Field(default_factory=list)

    @field_validator("admin_emails", mode="before")
    @classmethod
    def normalize_admin_emails(cls, value: Any) -> list[str]:
        if value is None:
            return []

        if isinstance(value, str):
            values = value.split(",")
        elif isinstance(value, list):
            values = value
        else:
            raise TypeError(
                "dashboard.admin_emails must be a list or comma-separated string",
            )

        normalized: list[str] = []
        seen: set[str] = set()

        for item in values:
            if item is None:
                continue

            cleaned = str(item).strip().lower()
            if not cleaned or cleaned in seen:
                continue

            seen.add(cleaned)
            normalized.append(cleaned)

        return normalized


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int
    environment: str
    public: PublicSettings
    search: SearchSettings
    embedding: EmbeddingSettings = Field(default_factory=EmbeddingSettings)
    knowledge: KnowledgeSettings
    dashboard: DashboardSettings = Field(default_factory=DashboardSettings)
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    r2: R2Settings = Field(default_factory=R2Settings)
    stripe: StripeSettings = Field(default_factory=StripeSettings)


def default_config_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "config"


def resolve_environment(environ: Mapping[str, str] | None = None) -> str:
    environment_source = environ if environ is not None else os.environ
    environment = environment_source.get("CERUL_ENV", "development").strip().lower()
    return environment or "development"


def load_settings(
    *,
    config_dir: Path | None = None,
    environment: str | None = None,
    environ: Mapping[str, str] | None = None,
) -> Settings:
    config_root = config_dir or default_config_dir()
    environment_source = environ if environ is not None else os.environ
    selected_environment = environment or resolve_environment(environment_source)

    merged_config = _load_yaml_file(config_root / "base.yaml")

    env_file = config_root / f"{selected_environment}.yaml"
    if env_file.exists():
        merged_config = _deep_merge(merged_config, _load_yaml_file(env_file))

    merged_config = _deep_merge(
        merged_config,
        _load_environment_overrides(environment_source),
    )
    merged_config["environment"] = selected_environment

    merged_config.setdefault("public", {})
    merged_config["public"].setdefault("app_env", selected_environment)

    return Settings.model_validate(merged_config)


def get_settings() -> Settings:
    global _SETTINGS_CACHE
    global _SETTINGS_CACHE_KEY

    cache_key = _build_cache_key()
    if _SETTINGS_CACHE is None or _SETTINGS_CACHE_KEY != cache_key:
        _SETTINGS_CACHE = load_settings()
        _SETTINGS_CACHE_KEY = cache_key

    return _SETTINGS_CACHE


def reset_settings_cache() -> None:
    global _SETTINGS_CACHE
    global _SETTINGS_CACHE_KEY

    _SETTINGS_CACHE = None
    _SETTINGS_CACHE_KEY = None


def _build_cache_key() -> tuple[str, tuple[tuple[str, str], ...]]:
    config_root = str(default_config_dir())
    relevant_variables = tuple(
        sorted(
            (name, value)
            for name, value in os.environ.items()
            if name == "CERUL_ENV"
            or name.startswith(_CONFIG_ENV_PREFIX)
            or name in _LEGACY_ENV_OVERRIDES
        )
    )
    return config_root, relevant_variables


def _deep_merge(base: Mapping[str, Any], override: Mapping[str, Any]) -> dict[str, Any]:
    merged = dict(base)

    for key, value in override.items():
        existing = merged.get(key)
        if isinstance(existing, Mapping) and isinstance(value, Mapping):
            merged[key] = _deep_merge(existing, value)
            continue

        merged[key] = value

    return merged


def _load_yaml_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Missing config file: {path}")

    parsed = yaml.safe_load(path.read_text(encoding="utf-8"))
    if parsed is None:
        return {}
    if not isinstance(parsed, dict):
        raise ValidationError.from_exception_data(
            "Settings",
            [
                {
                    "type": "model_type",
                    "loc": ("config", str(path)),
                    "input": parsed,
                    "ctx": {"class_name": "dict"},
                }
            ],
        )
    return parsed


def _load_environment_overrides(environ: Mapping[str, str]) -> dict[str, Any]:
    overrides: dict[str, Any] = {}

    for name, path in _LEGACY_ENV_OVERRIDES.items():
        if name not in environ:
            continue

        raw_value = environ[name]
        parsed_value = _parse_legacy_override(name, raw_value)
        if parsed_value is _SKIP:
            continue

        _assign_nested_value(overrides, path, parsed_value)

    for name, raw_value in environ.items():
        if not name.startswith(_CONFIG_ENV_PREFIX):
            continue

        path = tuple(
            segment.strip().lower()
            for segment in name[len(_CONFIG_ENV_PREFIX) :].split("__")
            if segment.strip()
        )
        if not path:
            continue

        _assign_nested_value(overrides, path, yaml.safe_load(raw_value))

    return overrides


class _SkipValue:
    pass


_SKIP = _SkipValue()


def _parse_legacy_override(name: str, raw_value: str) -> Any:
    cleaned = raw_value.strip()
    if name == "MMR_LAMBDA":
        try:
            return float(cleaned)
        except ValueError:
            return _SKIP

    if name == "EMBEDDING_DIMENSION":
        try:
            return int(cleaned)
        except ValueError:
            return _SKIP

    if name in ("EMBEDDING_NORMALIZE", "DEMO_MODE"):
        parsed = yaml.safe_load(cleaned)
        if isinstance(parsed, bool):
            return parsed
        return _SKIP

    if not cleaned:
        return None
    return cleaned


def _assign_nested_value(target: dict[str, Any], path: tuple[str, ...], value: Any) -> None:
    cursor = target
    for segment in path[:-1]:
        next_value = cursor.get(segment)
        if not isinstance(next_value, dict):
            next_value = {}
            cursor[segment] = next_value
        cursor = next_value

    cursor[path[-1]] = value
