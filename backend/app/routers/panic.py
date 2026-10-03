"""Panic / SOS endpoint.

Returns an immediate, tiered supportive response. The Next.js handler is
responsible for writing the row via the public.log_panic RPC, which also
notifies admins -- this service only decides *what to say*.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.crisis.responder import build_panic_response
from app.deps import require_token
from app.schemas import PanicRequest, PanicResponse

router = APIRouter(
    prefix="/panic",
    tags=["panic"],
    dependencies=[Depends(require_token)],
)


@router.post("", response_model=PanicResponse)
async def panic(
    payload: PanicRequest,
    settings: Settings = Depends(get_settings),
) -> PanicResponse:
    started = time.perf_counter()

    response = build_panic_response(
        urge_level=payload.urge_level,
        preference_type=payload.preference_type,
        current_streak=payload.current_streak,
        timezone=payload.timezone,
        trigger=payload.trigger,
    )
    response.latency_ms = round((time.perf_counter() - started) * 1000, 2)

    return response