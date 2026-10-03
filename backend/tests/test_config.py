"""Settings parsing.

These exist because a bug in here is invisible until the service refuses to
boot: a malformed .env takes down the whole moderation and panic API.
"""

import pytest
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.config import Settings, get_settings

TOKEN = "test-token"


def test_comma_separated_origins_are_split() -> None:
    """Regression: pydantic-settings json-decodes complex fields by default,
    so "http://a,http://b" raised SettingsError before the validator ran.
    """

    class WithDotEnv(Settings):
        model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    settings = WithDotEnv(
        ALLOWED_ORIGINS="http://localhost:4000,http://127.0.0.1:4000"
    )
    assert settings.allowed_origins == [
        "http://localhost:4000",
        "http://127.0.0.1:4000",
    ]


def test_origins_also_accept_a_json_list() -> None:
    """Backwards compatible with anyone who writes it JSON-style."""

    class WithDotEnv(Settings):
        model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    settings = WithDotEnv(ALLOWED_ORIGINS='["http://localhost:4000"]')
    assert settings.allowed_origins == ["http://localhost:4000"]


def test_origins_default_to_the_dev_port() -> None:
    settings = Settings(API_TOKEN=TOKEN)
    assert "http://localhost:4000" in settings.allowed_origins


def test_trailing_and_blank_entries_are_dropped() -> None:
    settings = Settings(
        API_TOKEN=TOKEN,
        ALLOWED_ORIGINS="http://a.com , ,http://b.com,",
    )
    assert settings.allowed_origins == ["http://a.com", "http://b.com"]


@pytest.mark.parametrize("mode", ["lexicon", "hybrid", "openai"])
def test_valid_moderation_modes(mode: str) -> None:
    assert Settings(API_TOKEN=TOKEN, MODERATION_MODE=mode).moderation_mode == mode


def test_invalid_moderation_mode_is_rejected() -> None:
    with pytest.raises(ValueError):
        Settings(API_TOKEN=TOKEN, MODERATION_MODE="anything-else")


def test_openai_is_off_without_a_key() -> None:
    settings = Settings(API_TOKEN=TOKEN, OPENAI_API_KEY="")
    assert settings.openai_enabled is False


def test_openai_needs_both_a_key_and_a_non_lexicon_mode() -> None:
    assert Settings(API_TOKEN=TOKEN, OPENAI_API_KEY="sk-x").openai_enabled is False
    assert (
        Settings(
            API_TOKEN=TOKEN, OPENAI_API_KEY="sk-x", MODERATION_MODE="hybrid"
        ).openai_enabled
        is True
    )


def test_real_env_file_parses() -> None:
    """The developer .env on this machine must not break collection."""
    get_settings.cache_clear()
    settings = Settings()
    assert isinstance(settings.allowed_origins, list)
    assert settings.moderation_mode in {"lexicon", "hybrid", "openai"}


def test_max_message_chars_mirrors_the_database_check() -> None:
    """chat_messages.content is capped at 2000 in Postgres. If these drift,
    the endpoint rejects messages the database would have accepted."""
    assert Settings(API_TOKEN=TOKEN).max_message_chars == 2000