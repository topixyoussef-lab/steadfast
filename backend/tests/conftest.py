import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings  # noqa: E402


@pytest.fixture
def settings() -> Settings:
    # Never touch the real environment in tests.
    return Settings(
        API_TOKEN="test-token",
        MODERATION_MODE="lexicon",
        OPENAI_API_KEY=None,
    )