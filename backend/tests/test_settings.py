from __future__ import annotations

from pathlib import Path
from textwrap import dedent

import pytest
from pydantic import ValidationError

from app.config import load_settings


def write_config(path: Path, content: str) -> None:
    path.write_text(dedent(content).strip() + "\n", encoding="utf-8")


def test_load_settings_selects_environment_file(tmp_path: Path) -> None:
    write_config(
        tmp_path / "base.yaml",
        """
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
        """,
    )
    write_config(
        tmp_path / "development.yaml",
        """
        public:
          app_env: development
          api_base_url: http://localhost:8000
          web_base_url: http://localhost:3000
          demo_mode: true
        """,
    )
    write_config(
        tmp_path / "production.yaml",
        """
        public:
          app_env: production
          api_base_url: https://api.cerul.ai
          web_base_url: https://cerul.ai
          demo_mode: false
        """,
    )

    settings = load_settings(config_dir=tmp_path, environment="production", environ={})

    assert settings.environment == "production"
    assert settings.public.app_env == "production"
    assert settings.public.api_base_url == "https://api.cerul.ai"
    assert settings.search.mmr_lambda == 0.75
    assert settings.knowledge.download.max_height == 480
    assert settings.knowledge.transcription.model == "whisper-1"
    assert settings.knowledge.transcription.base_url == "https://api.openai.com/v1"


def test_load_settings_applies_environment_variable_overrides(tmp_path: Path) -> None:
    write_config(
        tmp_path / "base.yaml",
        """
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
        """,
    )
    write_config(
        tmp_path / "development.yaml",
        """
        public:
          app_env: development
          api_base_url: http://localhost:8000
          web_base_url: http://localhost:3000
          demo_mode: true
        """,
    )

    settings = load_settings(
        config_dir=tmp_path,
        environment="development",
        environ={
            "CERUL__KNOWLEDGE__RERANK_TOP_N": "42",
            "CERUL__KNOWLEDGE__DOWNLOAD__MAX_HEIGHT": "360",
            "CERUL__KNOWLEDGE__TRANSCRIPTION__MODEL": "custom-whisper",
            "ASR_BASE_URL": "https://transcribe.example.com/v1",
            "DATABASE_URL": "postgresql://cerul:cerul@localhost:5432/cerul",
            "MMR_LAMBDA": "0.55",
            "R2_BUCKET_NAME": "cerul-assets",
            "R2_PUBLIC_URL": "https://cdn.example.com/",
            "WEB_BASE_URL": "https://app.example.com",
        },
    )

    assert settings.search.mmr_lambda == 0.55
    assert settings.knowledge.rerank_top_n == 42
    assert settings.knowledge.download.max_height == 360
    assert settings.knowledge.transcription.model == "custom-whisper"
    assert settings.knowledge.transcription.base_url == "https://transcribe.example.com/v1"
    assert settings.database.url == "postgresql://cerul:cerul@localhost:5432/cerul"
    assert settings.r2.bucket_name == "cerul-assets"
    assert settings.r2.public_url == "https://cdn.example.com"
    assert settings.public.web_base_url == "https://app.example.com"


def test_load_settings_still_accepts_legacy_openai_transcribe_aliases(tmp_path: Path) -> None:
    write_config(
        tmp_path / "base.yaml",
        """
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
        """,
    )
    write_config(
        tmp_path / "development.yaml",
        """
        public:
          app_env: development
          api_base_url: http://localhost:8000
          web_base_url: http://localhost:3000
          demo_mode: true
        """,
    )

    settings = load_settings(
        config_dir=tmp_path,
        environment="development",
        environ={"OPENAI_TRANSCRIBE_MODEL": "legacy-whisper"},
    )

    assert settings.knowledge.transcription.model == "legacy-whisper"


def test_load_settings_raises_for_missing_required_field(tmp_path: Path) -> None:
    write_config(
        tmp_path / "base.yaml",
        """
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
        """,
    )
    write_config(
        tmp_path / "development.yaml",
        """
        public:
          app_env: development
          web_base_url: http://localhost:3000
          demo_mode: true
        """,
    )

    with pytest.raises(ValidationError) as exc_info:
        load_settings(config_dir=tmp_path, environment="development", environ={})

    assert "public.api_base_url" in str(exc_info.value)
