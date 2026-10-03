"""Shared authentication dependency for the internal API."""

from __future__ import annotations

import secrets

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings


def require_token(
    x_api_token: str | None = Header(default=None, alias="X-API-Token"),
    settings: Settings = Depends(get_settings),
) -> None:
    # Constant-time compare so the token cannot be probed byte by byte.
    if not x_api_token or not secrets.compare_digest(x_api_token, settings.api_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API token.",
        )