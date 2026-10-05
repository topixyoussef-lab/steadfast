"""Liveness and readiness probes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app import __version__
from app.config import Settings, get_settings

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(settings: Settings = Depends(get_settings)) -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "moderation_mode": settings.moderation_mode,
        "openai_enabled": settings.openai_enabled,
        # Whether Gemini is actually judging, and which model answers. Both are
        # public, and together they are the only way to confirm a deploy of the
        # moderation config without the API token.
        "gemini_enabled": settings.gemini_enabled,
        "gemini_model": settings.gemini_model if settings.gemini_enabled else None,
    }