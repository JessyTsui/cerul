import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import reset_settings_cache


@pytest.fixture(autouse=True)
def clear_settings_cache() -> None:
    reset_settings_cache()
    yield
    reset_settings_cache()
