from __future__ import annotations

from pathlib import Path
from textwrap import dedent

import pytest

from app.config import load_settings


def write_config(path: Path, content: str) -> None:
    path.write_text(dedent(content).strip() + "\n", encoding="utf-8")


BASE_YAML = """
    version: 1
    public:
      default_track: broll
      enabled_tracks:
        - broll
        - knowledge
    search:
      mmr_lambda: 0.75
      clip_score_threshold: null
    knowledge:
      scene_threshold: 0.35
      rerank_top_n: 20
      rerank_prompt_template: default
"""


def test_load_settings_with_env_overrides(tmp_path: Path) -> None:
    write_config(tmp_path / "base.yaml", BASE_YAML)

    settings = load_settings(
        config_dir=tmp_path,
        environment="development",
        environ={
            "API_BASE_URL": "http://localhost:8000",
            "WEB_BASE_URL": "http://localhost:3000",
            "DEMO_MODE": "true",
        },
    )

    assert settings.environment == "development"
    assert settings.public.app_env == "development"
    assert settings.public.api_base_url == "http://localhost:8000"
    assert settings.public.demo_mode is True
    assert settings.search.mmr_lambda == 0.75
    assert settings.knowledge.download.max_height == 480
    assert settings.knowledge.transcription.model == "whisper-1"


def test_load_settings_applies_environment_variable_overrides(tmp_path: Path) -> None:
    write_config(tmp_path / "base.yaml", BASE_YAML)

    settings = load_settings(
        config_dir=tmp_path,
        environment="development",
        environ={
            "API_BASE_URL": "http://localhost:8000",
            "WEB_BASE_URL": "http://localhost:3000",
            "CERUL__KNOWLEDGE__RERANK_TOP_N": "42",
            "CERUL__KNOWLEDGE__DOWNLOAD__MAX_HEIGHT": "360",
            "CERUL__KNOWLEDGE__TRANSCRIPTION__MODEL": "custom-whisper",
            "ASR_BASE_URL": "https://transcribe.example.com/v1",
            "DATABASE_URL": "postgresql://cerul:cerul@localhost:5432/cerul",
            "MMR_LAMBDA": "0.55",
            "R2_BUCKET_NAME": "cerul-assets",
            "R2_PUBLIC_URL": "https://cdn.example.com/",
            "RERANK_MODEL": "gpt-4o-mini",
        },
    )

    assert settings.search.mmr_lambda == 0.55
    assert settings.knowledge.rerank_top_n == 42
    assert settings.knowledge.rerank_model == "gpt-4o-mini"
    assert settings.knowledge.download.max_height == 360
    assert settings.knowledge.transcription.model == "custom-whisper"
    assert settings.knowledge.transcription.base_url == "https://transcribe.example.com/v1"
    assert settings.database.url == "postgresql://cerul:cerul@localhost:5432/cerul"
    assert settings.r2.bucket_name == "cerul-assets"
    assert settings.r2.public_url == "https://cdn.example.com"


def test_load_settings_still_accepts_legacy_openai_transcribe_aliases(tmp_path: Path) -> None:
    write_config(tmp_path / "base.yaml", BASE_YAML)

    settings = load_settings(
        config_dir=tmp_path,
        environment="development",
        environ={
            "API_BASE_URL": "http://localhost:8000",
            "WEB_BASE_URL": "http://localhost:3000",
            "OPENAI_TRANSCRIBE_MODEL": "legacy-whisper",
        },
    )

    assert settings.knowledge.transcription.model == "legacy-whisper"


def test_load_settings_raises_for_missing_base_yaml(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        load_settings(config_dir=tmp_path, environment="development", environ={})


def test_load_settings_still_loads_env_yaml_if_present(tmp_path: Path) -> None:
    write_config(tmp_path / "base.yaml", BASE_YAML)
    write_config(
        tmp_path / "staging.yaml",
        """
        public:
          demo_mode: true
        """,
    )

    settings = load_settings(
        config_dir=tmp_path,
        environment="staging",
        environ={
            "API_BASE_URL": "https://staging.cerul.ai",
            "WEB_BASE_URL": "https://staging.cerul.ai",
        },
    )

    assert settings.public.demo_mode is True
    assert settings.public.app_env == "staging"
