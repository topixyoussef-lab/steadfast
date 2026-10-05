"""Gemini as the moderator of a recovery community chat.

The model decides. This module only ever returns a verdict it can prove it read:
any transport failure, throttling, safety filter, truncation or unparsable body
comes back as ``None`` so the caller falls through to the deterministic lexicon.
A failure also opens a short cooldown, because a rate-limited key must not put a
slow third party in the path of every message members send.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import time
from typing import Any

import httpx

from app.config import Settings
from app.moderation.cache import BoundedCache

_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

PROMPT = """You are the moderator of an anonymous peer-support chat for adults recovering
from pornography and gambling addiction. Members are anonymous and many are in
crisis. Judge what the post is trying to DO, not which words appear in it.

block: offering, selling, or soliciting porn, gambling, or paid sexual content;
asking where or how to obtain them; steering another member toward a purchase or
into private messages for that purpose; sharing a link whose purpose is to
distribute that material; any contact aimed at a minor for these; or an active,
planned intent to seriously hurt themselves.
flag: intent is unclear, a solicitation is wrapped in recovery language, an
unexplained outbound link, or a relapse or acute-distress disclosure that a human
should follow up on.
allow: recovery talk, including explicit description of past use or of a relapse;
medication and side-effect questions; cravings stated without offering anything;
religious, philosophical or motivational discussion; warning others about
someone who is soliciting.

Do not block a message just because it contains a dirty word. Do not allow a
message just because it is politely phrased.

Respond with JSON only, no prose and no code fence:
{"decision":"allow"|"flag"|"block","categories":["<short_snake_case>", ...],"reason":"<one sentence>"}

Message to judge:
"""

_MEDIA_PROMPT = """You are the moderator of an anonymous peer-support chat for adults recovering
from pornography and gambling addiction. Members are anonymous and many are in
crisis.

You are judging an ATTACHMENT, not a text post. The member may have added a
caption; treat it as context, not as the thing to judge.

block: the attachment is, or is almost certainly, pornographic, sexually explicit,
gambling-related, or paid sexual content; it solicits, offers, or advertises any of
those; it contains contact details aimed at a minor; or the audio says the member
intends to seriously hurt themselves. Blur and explicit nudity are the same
verdict. A clothed photo, a screenshot of a recovery app, a selfie, a landscape,
and a text screenshot are not.

flag: the content is unclear, suggestive without being explicit, a screenshot of a
chat or a profile rather than of the world, or a relapse or distress disclosure a
human should follow up on.

allow: recovery talk, medication and side-effect questions, cravings stated without
offering anything, screenshots of progress, self-harm-free encouragement, and
ordinary everyday photos.

Where the answer is not obvious from the pixels or the audio, choose flag. A wrong
flag costs a moderator a minute; a wrong allow cannot be undone.

Respond with JSON only, no prose and no code fence:
{"decision":"allow"|"flag"|"block","categories":["<short_snake_case>", ...],
 "reason":"<one sentence>","transcript":"<every word you can hear, or empty if none>",
 "description":"<one plain sentence describing what the attachment shows or says>"}

Caption from the member, if any:
"""

_VALID_DECISIONS = {"allow", "flag", "block"}

_cache = BoundedCache()

# Seconds until which Gemini is not asked again after a failure, as
# time.monotonic(). Module state on purpose: it is per worker, and a cold worker
# simply pays for one failed call.
_cooldown_until = 0.0

# Test hook: patched to a fake transport in the suite.
_transport: httpx.AsyncBaseTransport | None = None


def reset_state() -> None:
    """Clear the cache and the failure cooldown. Used between tests."""
    global _cooldown_until
    _cache.clear()
    _cooldown_until = 0.0


def _parse(text: str) -> dict[str, Any] | None:
    """Read a verdict out of whatever the model actually answered with."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    decision = str(payload.get("decision", "")).strip().lower()
    if decision not in _VALID_DECISIONS:
        return None

    raw_categories = payload.get("categories")
    if isinstance(raw_categories, str):
        raw_categories = [raw_categories]
    if not isinstance(raw_categories, list):
        raw_categories = []
    categories = [
        re.sub(r"[^a-z0-9]+", "_", str(item).strip().lower()).strip("_")
        for item in raw_categories
        if str(item).strip()
    ]

    return {
        "decision": decision,
        "categories": [c for c in categories if c][:8],
        "reason": str(payload.get("reason", "")).strip()[:300],
    }


def _failure(settings: Settings, reason: str) -> None:
    global _cooldown_until
    _cooldown_until = time.monotonic() + settings.gemini_cooldown_seconds
    # `reason` names the failure mode, never the message text or the key.
    logging.getLogger(__name__).warning("gemini unavailable (%s), using lexicon", reason)


async def judge(content: str, settings: Settings) -> dict[str, Any] | None:
    """Ask Gemini. Returns a verdict dict, or None to mean "lexicon decides"."""
    if time.monotonic() < _cooldown_until:
        return None

    key = hashlib.sha256(f"{settings.gemini_model}:{content}".encode()).hexdigest()
    cached = _cache.get(key)
    if cached is not None:
        return cached

    body = {
        "contents": [{"parts": [{"text": PROMPT + content}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            # flash-lite answers this in ~40 tokens; the reasoning models were
            # truncating their JSON at 200, which reads as an unavailable model.
            "maxOutputTokens": 512,
        },
    }

    try:
        async with httpx.AsyncClient(
            transport=_transport, timeout=settings.gemini_timeout_seconds
        ) as client:
            response = await client.post(
                _ENDPOINT.format(model=settings.gemini_model),
                json=body,
                headers={"x-goog-api-key": settings.gemini_api_key or "",
                         "Content-Type": "application/json"},
            )
            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        _failure(settings, "timeout")
        return None
    except httpx.HTTPStatusError as exc:
        _failure(settings, f"http_{exc.response.status_code}")
        return None
    except (httpx.HTTPError, ValueError):
        _failure(settings, "transport")
        return None

    candidates = data.get("candidates") or []
    if not candidates:
        _failure(settings, "no_candidates")
        return None

    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(str(part.get("text", "")) for part in parts)
    if not text.strip():
        # A safety-blocked or empty answer is not a verdict; it is no answer.
        _failure(settings, "empty_response")
        return None

    verdict = _parse(text)
    if verdict is None:
        _failure(settings, "unparsable")
        return None

    _cache.set(key, verdict)
    return verdict


def _parse_media(text: str) -> dict[str, Any] | None:
    """Read a verdict plus the transcript or description out of the answer.

    Same strictness as _parse: an unparsable body is no answer, because the
    caller's response to a missing verdict is to refuse the upload. A transcript
    is not required -- a silent clip has none -- but a decision is.
    """
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    decision = str(payload.get("decision", "")).strip().lower()
    if decision not in _VALID_DECISIONS:
        return None

    raw_categories = payload.get("categories")
    if isinstance(raw_categories, str):
        raw_categories = [raw_categories]
    if not isinstance(raw_categories, list):
        raw_categories = []

    return {
        "decision": decision,
        "categories": [
            re.sub(r"[^a-z0-9]+", "_", str(item).strip().lower()).strip("_")
            for item in raw_categories
            if str(item).strip()
        ][:8],
        "reason": str(payload.get("reason", "")).strip()[:300],
        "transcript": str(payload.get("transcript", "")).strip()[:4000],
        "description": str(payload.get("description", "")).strip()[:600],
    }


async def judge_media(
    *,
    kind: str,
    mime_type: str,
    data: bytes,
    caption: str,
    settings: Settings,
) -> dict[str, Any] | None:
    """Ask Gemini to see or hear an attachment. Returns None to mean "refuse it".

    There is deliberately no lexicon fallback here, and that asymmetry is the
    whole point of this function. Text can fall back to a deterministic word
    list because words are all a text message is. A photograph and a recording
    cannot: there is no local rule that distinguishes a recovery selfie from a
    solicitation, so an unavailable model does not downgrade to a weaker verdict,
    it produces no verdict at all and the upload is refused.

    The failure cooldown is shared with judge() on purpose. A throttled key must
    not be able to spend extra latency on media calls while text calls are
    already being served from the lexicon.

    Caching is by content hash, and the caption is part of the hash: the same
    photo posted under a different caption is a different moderation question.
    """
    global _cooldown_until

    if time.monotonic() < _cooldown_until:
        return None

    if len(data) > settings.gemini_media_max_bytes:
        logging.getLogger(__name__).warning(
            "media over %d bytes, refusing without a verdict",
            settings.gemini_media_max_bytes,
        )
        return None

    key = hashlib.sha256(
        f"{settings.gemini_model}:{kind}:{mime_type}:{len(data)}:".encode()
        + hashlib.sha256(data).digest()
        + caption.encode()
    ).hexdigest()
    cached = _cache.get(key)
    if cached is not None:
        return cached

    body = {
        "contents": [
            {
                "parts": [
                    {"text": _MEDIA_PROMPT + caption},
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": base64.b64encode(data).decode("ascii"),
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            # Larger than the text call because it must also carry a transcript
            # and a description alongside the verdict.
            "maxOutputTokens": 1024,
        },
    }

    try:
        async with httpx.AsyncClient(
            transport=_transport, timeout=settings.gemini_media_timeout_seconds
        ) as client:
            response = await client.post(
                _ENDPOINT.format(model=settings.gemini_model),
                json=body,
                headers={"x-goog-api-key": settings.gemini_api_key or "",
                         "Content-Type": "application/json"},
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.TimeoutException:
        _failure(settings, "media_timeout")
        return None
    except httpx.HTTPStatusError as exc:
        _failure(settings, f"media_http_{exc.response.status_code}")
        return None
    except (httpx.HTTPError, ValueError):
        _failure(settings, "media_transport")
        return None

    candidates = payload.get("candidates") or []
    if not candidates:
        _failure(settings, "media_no_candidates")
        return None

    parts = (candidates[0].get("content") or {}).get("parts") or []
    text = "".join(str(part.get("text", "")) for part in parts)
    if not text.strip():
        # The safety filter can refuse to describe the attachment at all. That
        # is not a verdict, and an unviewable attachment is not safe to publish.
        _failure(settings, "media_empty_response")
        return None

    verdict = _parse_media(text)
    if verdict is None:
        _failure(settings, "media_unparsable")
        return None

    _cache.set(key, verdict)
    return verdict
