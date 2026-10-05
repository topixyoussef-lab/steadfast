"""Application settings, loaded from environment variables."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Shared secret. Next.js sends this on every call.
    api_token: str = Field(default="dev-token", alias="API_TOKEN")

    # NoDecode is required here. Without it pydantic-settings tries to
    # json.loads() any complex-typed value coming from the environment, so a
    # plain "a,b" value in .env raises SettingsError before _split_origins
    # ever runs, and the service refuses to boot.
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:4000",
            "http://127.0.0.1:4000",
        ],
        alias="ALLOWED_ORIGINS",
    )

    # "lexicon"  -> fully local, zero cost, always on
    # "hybrid"   -> lexicon first, OpenAI as a second opinion on risk
    # "openai"   -> OpenAI only (not recommended for a safety-critical MVP)
    # "gemini"   -> Gemini is the judge of every message. The lexicon still
    #               runs, and it is what decides whenever Gemini is throttled,
    #               slow, or answers in a shape we cannot parse.
    moderation_mode: str = Field(default="lexicon", alias="MODERATION_MODE")

    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: str = Field(default="omni-moderation-latest", alias="OPENAI_MODEL")

    gemini_api_key: str | None = Field(default=None, alias="GEMINI_API_KEY")
    # "gemini-flash-latest" and the numbered flash models were both unusable on
    # this project's key: 503 high-demand and 429 quota. flash-lite answers in
    # about 900 ms and returns parseable JSON.
    gemini_model: str = Field(default="gemini-flash-lite-latest", alias="GEMINI_MODEL")

    # Gemini is asked for a verdict on every message in "gemini" mode, so this
    # ceiling is what a member waits on before the lexicon decides instead. It
    # has to stay under the 4 s the Next.js client allows for the whole call
    # (src/lib/python-client.ts TIMEOUT_MS); past that the client gives up and
    # chat fails closed, which is worse than a lexicon-only verdict.
    gemini_timeout_seconds: float = Field(default=2.0, alias="GEMINI_TIMEOUT_SECONDS")

    # After a 429/503/timeout the service stops asking Gemini for this many
    # seconds and answers from the lexicon, so a throttled key does not put a
    # slow third party in the critical path of every chat message.
    gemini_cooldown_seconds: float = Field(default=30.0, alias="GEMINI_COOLDOWN_SECONDS")

    # Only reached in "hybrid" mode, and only after the lexicon scores >= this.
    hybrid_escalate_score: float = Field(default=0.4, alias="HYBRID_ESCALATE_SCORE")

    # Seconds to wait on the OpenAI call before falling back to the lexicon
    # verdict. Never let a slow third party block a chat message.
    openai_timeout_seconds: float = Field(default=2.5, alias="OPENAI_TIMEOUT_SECONDS")

    # Hard ceiling on message length, mirrored from the Postgres CHECK.
    max_message_chars: int = Field(default=2000, alias="MAX_MESSAGE_CHARS")

    # Set to "production" on the deployed service. This API is internal and
    # describes itself entirely through its schema, so /docs and /openapi.json
    # hand a probing stranger the full request/response shape of an endpoint
    # that is only supposed to be reachable by the Next.js server.
    environment: str = Field(default="development", alias="ENVIRONMENT")

    @property
    def docs_enabled(self) -> bool:
        return self.environment != "production"

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept a JSON list, a comma-separated string, or a real list.

        Being forgiving here matters because a malformed value takes the whole
        service down, and the difference between these three forms is invisible
        to whoever wrote the file.
        """
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    parsed = None
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in text.split(",") if item.strip()]
        return value

    @field_validator("moderation_mode")
    @classmethod
    def _check_mode(cls, value: str) -> str:
        allowed = {"lexicon", "hybrid", "openai", "gemini"}
        if value not in allowed:
            raise ValueError(f"MODERATION_MODE must be one of {sorted(allowed)}")
        return value

    @property
    def openai_enabled(self) -> bool:
        # "gemini" mode must not also trigger the OpenAI escalation path.
        return bool(self.openai_api_key) and self.moderation_mode in {"hybrid", "openai"}

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key) and self.moderation_mode == "gemini"


@lru_cache
def get_settings() -> Settings:
    return Settings()
