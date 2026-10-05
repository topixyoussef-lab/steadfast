"""Request/response contracts shared with the Next.js route handlers."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["info", "warning", "critical"]
Decision = Literal["allow", "flag", "block"]
PreferenceType = Literal["islamic", "christian", "general"]


class ModerateRequest(BaseModel):
    # Length is enforced by the endpoint against Settings.max_message_chars
    # so the limit stays configurable in one place. The Postgres CHECK on
    # chat_messages is the final backstop.
    content: str = Field(min_length=1)
    user_id: str | None = None
    room_id: str | None = None
    message_id: str | None = None
    preference_type: PreferenceType | None = None


class ModerateResponse(BaseModel):
    decision: Decision
    severity: Severity
    categories: list[str] = Field(default_factory=list)
    matched_terms: list[str] = Field(default_factory=list)
    reason: str
    engine: str
    latency_ms: float
    request_id: str | None = None


class MediaModerateResponse(ModerateResponse):
    """A verdict on an attachment.

    `transcript` is populated for audio and `description` for image and video,
    because one is the readable content and the other stands in for it. Both are
    stored on the attachment row so a moderator can review without opening the
    file, and so moderation_log keeps a text preview of a post that had no text.
    """

    transcript: str = ""
    description: str = ""


class PanicRequest(BaseModel):
    urge_level: int = Field(ge=0, le=10)
    preference_type: PreferenceType | None = None
    current_streak: int = Field(default=0, ge=0)
    message: str | None = Field(default=None, max_length=280)
    trigger: str | None = Field(default=None, max_length=120)
    timezone: str | None = Field(default=None, max_length=64)


class CopingStep(BaseModel):
    title: str
    detail: str


class PanicResponse(BaseModel):
    response: str
    steps: list[CopingStep]
    grounding: list[str]
    escalate_to_admins: bool
    cache_key: str
    urge_level: int
    latency_ms: float
