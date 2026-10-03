"""Text moderation endpoint.

Next.js calls this before writing a chat message. A "block" means the row is
never inserted; a "flag" means it is stored with is_flagged_by_ai set for the
admin dashboard.
"""

from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import Settings, get_settings
from app.deps import require_token
from app.moderation.engine import moderate
from app.schemas import ModerateRequest, ModerateResponse

router = APIRouter(
    prefix="/moderate",
    tags=["moderation"],
    dependencies=[Depends(require_token)],
)


@router.post("", response_model=ModerateResponse)
async def moderate_text(
    payload: ModerateRequest,
    settings: Settings = Depends(get_settings),
) -> ModerateResponse:
    content = payload.content.strip()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message content cannot be empty.",
        )

    if len(content) > settings.max_message_chars:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Message exceeds {settings.max_message_chars} characters.",
        )

    started = time.perf_counter()
    result = await moderate(content, settings)
    result["latency_ms"] = round((time.perf_counter() - started) * 1000, 2)
    result["request_id"] = str(uuid.uuid4())

    return ModerateResponse(**result)