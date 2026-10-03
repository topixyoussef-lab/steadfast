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
    }