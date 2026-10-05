"""Text and media moderation endpoints.

Next.js calls these before writing a chat message. A "block" means the row is
never inserted; a "flag" means it is stored with is_flagged_by_ai set for the
admin dashboard.

The media endpoint takes raw bytes rather than JSON. An image or a video is up to
4 MiB, and base64 inside a JSON body would inflate that by a third before a byte
reached this process; carrying the file as the request body and the metadata as
headers keeps the size honest and keeps the whole request under what the Next.js
host will accept.
"""

from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app.config import Settings, get_settings
from app.deps import require_token
from app.moderation.engine import moderate
from app.moderation.gemini import judge_media
from app.schemas import MediaModerateResponse, ModerateRequest, ModerateResponse

router = APIRouter(
    prefix="/moderate",
    tags=["moderation"],
    dependencies=[Depends(require_token)],
)

# Only what the Next.js route is allowed to send, decided here rather than
# trusted: an unknown kind or a MIME type outside this set is a 422 before any
# model call is made, so a caller cannot use the endpoint to forward arbitrary
# content to Gemini.
_ALLOWED_MEDIA = {
    "image": {"image/jpeg", "image/png", "image/webp"},
    "audio": {"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"},
    "video": {"video/mp4", "video/webm"},
}


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


@router.post("/media", response_model=MediaModerateResponse)
async def moderate_media(
    request: Request,
    media_kind: str = Header(default="", alias="X-Media-Kind"),
    mime_type: str = Header(default="", alias="X-Media-Mime"),
    caption: str = Header(default="", alias="X-Media-Caption"),
    settings: Settings = Depends(get_settings),
) -> MediaModerateResponse:
    """Judge an attachment. There is no lexicon fallback by design.

    A 503 here means "no verdict could be obtained", and the Next.js caller
    treats that as a refusal to upload rather than as a reason to let the file
    through unreviewed. That is the only safe reading of an unavailable model
    for a medium no local rule can read.
    """
    kind = media_kind.strip().lower()
    mime = mime_type.strip().lower()

    if kind not in _ALLOWED_MEDIA:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported attachment kind: {kind or 'missing'}.",
        )
    if mime not in _ALLOWED_MEDIA[kind]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{mime} is not an accepted {kind} type.",
        )

    # An HTTP header is not a good place for 4000 characters of caption, and it
    # is also not trusted. Trimmed and bounded here so a caller cannot smuggle a
    # whole message into the prompt.
    note = caption.strip()[: settings.max_message_chars]

    data = await request.body()

    if not data:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Attachment body is empty.",
        )
    if len(data) > settings.gemini_media_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Attachment is too large to review.",
        )

    started = time.perf_counter()
    verdict = await judge_media(
        kind=kind,
        mime_type=mime,
        data=data,
        caption=note,
        settings=settings,
    )

    if verdict is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not review this attachment right now.",
        )

    return MediaModerateResponse(
        decision=verdict["decision"],
        severity=("critical" if verdict["decision"] == "block" else
                  "warning" if verdict["decision"] == "flag" else "info"),
        categories=verdict["categories"],
        matched_terms=[],
        reason=verdict["reason"],
        engine="gemini",
        latency_ms=round((time.perf_counter() - started) * 1000, 2),
        request_id=str(uuid.uuid4()),
        transcript=verdict["transcript"],
        description=verdict["description"],
    )