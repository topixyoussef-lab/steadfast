"""Moderating an attachment instead of a sentence.

The asymmetry with text is the thing these tests exist to pin down:

  * text falls back to a deterministic lexicon when Gemini is unavailable,
    because words are all a text message is;
  * an attachment does not fall back to anything, because no local rule can tell
    a recovery selfie from a solicitation. An unavailable model must produce no
    verdict at all, and a missing verdict must mean the upload is refused.

The second property is that a blocked file is never stored, and a flagged file
keeps the model's own words -- transcript or description -- so a moderator can
review it without opening it.
"""

from __future__ import annotations

import base64
import json

import httpx
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import Settings, get_settings
from app.main import app
from app.moderation import gemini
from app.moderation.gemini import judge_media
from tests.test_gemini import ScriptedTransport, gemini_settings

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"fake-image-payload" * 40
WEBP_BYTES = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"fake-clip" * 40

ALLOW = "allow"
FLAG = "flag"
BLOCK = "block"


def media_settings(**overrides) -> Settings:
    values = {
        "GEMINI_MEDIA_TIMEOUT_SECONDS": 12.0,
        "GEMINI_MEDIA_MAX_BYTES": 4_194_304,
    }
    values.update(overrides)
    return gemini_settings(**values)


def media_verdict(
    decision: str = ALLOW,
    *,
    categories: list[str] | None = None,
    reason: str = "an ordinary photo",
    transcript: str = "",
    description: str = "",
    text: str | None = None,
) -> tuple[int, dict]:
    body = (
        text
        if text is not None
        else json.dumps(
            {
                "decision": decision,
                "categories": categories or [],
                "reason": reason,
                "transcript": transcript,
                "description": description,
            }
        )
    )
    return 200, {"candidates": [{"content": {"parts": [{"text": body}]}}]}


THROTTLED = 429, {"error": {"code": 429, "message": "Resource has been exhausted"}}
OVERLOADED = 503, {"error": {"code": 503, "message": "The model is overloaded"}}
NO_CANDIDATES = 200, {"candidates": []}
EMPTY_PARTS = 200, {"candidates": [{"content": {"parts": []}}]}
SAFETY_BLOCK = 200, {"promptFeedback": {"blockReason": "SAFETY"}}


@pytest.fixture
def transport(monkeypatch):
    gemini.reset_state()

    def install(*responses) -> ScriptedTransport:
        fake = ScriptedTransport(*responses)
        monkeypatch.setattr(gemini, "_transport", fake)
        return fake

    yield install
    gemini.reset_state()


async def judge(**overrides):
    kwargs = {
        "kind": "image",
        "mime_type": "image/png",
        "data": PNG_BYTES,
        "caption": "",
        "settings": media_settings(),
    }
    kwargs.update(overrides)
    return await judge_media(**kwargs)


# ---------------------------------------------------------------------------
# A verdict is a verdict
# ---------------------------------------------------------------------------
async def test_a_clean_photo_is_allowed(transport) -> None:
    transport(media_verdict(ALLOW, categories=["everyday"]))
    result = await judge()
    assert result["decision"] == "allow"
    assert "everyday" in result["categories"]


async def test_a_soliciting_photo_is_blocked(transport) -> None:
    transport(media_verdict(BLOCK, categories=["porn"], reason="explicit"))
    result = await judge()
    assert result["decision"] == "block"


async def test_an_ambiguous_clip_is_held_for_a_human(transport) -> None:
    transport(media_verdict(FLAG, categories=["unclear_intent"]))
    result = await judge(kind="video", mime_type="video/mp4", data=WEBP_BYTES)
    assert result["decision"] == "flag"


# ---------------------------------------------------------------------------
# The fallback that deliberately does not exist
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "outcome",
    [THROTTLED, OVERLOADED, NO_CANDIDATES, EMPTY_PARTS, SAFETY_BLOCK],
    ids=["429", "503", "no_candidates", "empty_parts", "safety_block"],
)
async def test_an_unavailable_model_produces_no_verdict_at_all(
    transport, outcome
) -> None:
    transport(outcome)
    assert await judge() is None


async def test_unparsable_prose_is_no_verdict(transport) -> None:
    transport(media_verdict(text="I would rather not describe this image."))
    assert await judge() is None


async def test_a_decision_outside_the_vocabulary_is_no_verdict(transport) -> None:
    transport(media_verdict(text=json.dumps({"decision": "probably_fine"})))
    assert await judge() is None


async def test_timeout_is_no_verdict(transport) -> None:
    transport(httpx.ReadTimeout("timed out"))
    assert await judge() is None


async def test_an_attachment_too_large_is_never_sent_unread(transport) -> None:
    """The size check happens before the call, not after it."""
    fake = transport(media_verdict(ALLOW))
    settings = media_settings(GEMINI_MEDIA_MAX_BYTES=16)
    assert await judge(settings=settings, data=PNG_BYTES) is None
    assert fake.calls == []


async def test_a_media_failure_shares_the_text_cooldown(transport) -> None:
    """A throttled key must not spend extra latency on media while text falls back."""
    fake = transport(THROTTLED)
    assert await judge() is None
    assert await judge() is None
    assert len(fake.calls) == 1, "the cooldown means one failed call, not one per upload"


async def test_text_still_falls_back_while_media_refuses(transport, monkeypatch) -> None:
    """The asymmetry in one test: text is judged, media is not."""
    from app.moderation.engine import moderate

    transport(THROTTLED)
    assert (await moderate("here is my pornhub link", media_settings()))["engine"] == "lexicon"
    assert await judge() is None


# ---------------------------------------------------------------------------
# What we send
# ---------------------------------------------------------------------------
async def test_the_bytes_travel_inline_and_the_caption_rides_the_prompt(
    transport,
) -> None:
    fake = transport(media_verdict(ALLOW))
    await judge(caption="day 12, feeling lighter today")
    call = fake.calls[0]

    parts = call["body"]["contents"][0]["parts"]
    inline = parts[1]["inlineData"]
    assert inline["mimeType"] == "image/png"
    # base64 of the exact bytes, not a hash or a filename.
    assert base64.b64decode(inline["data"]) == PNG_BYTES

    prompt = parts[0]["text"]
    assert prompt.startswith(gemini._MEDIA_PROMPT)
    assert prompt.endswith("day 12, feeling lighter today")
    assert call["headers"]["x-goog-api-key"] == "test-gemini-key"


async def test_the_media_prompt_asks_for_a_verdict_not_a_description_only(
    transport,
) -> None:
    """It has to carry the block rules, or a photo is described and allowed."""
    fake = transport(media_verdict(ALLOW))
    await judge()
    prompt = fake.calls[0]["body"]["contents"][0]["parts"][0]["text"]
    for rule in ("block:", "flag:", "allow:"):
        assert rule in prompt
    assert "pornograph" in prompt.lower()
    assert "transcript" in prompt and "description" in prompt


async def test_media_asks_for_json_at_zero_temperature(transport) -> None:
    fake = transport(media_verdict(ALLOW))
    await judge()
    config = fake.calls[0]["body"]["generationConfig"]
    assert config["temperature"] == 0
    assert config["responseMimeType"] == "application/json"


async def test_the_same_bytes_and_caption_are_asked_about_once(transport) -> None:
    fake = transport(media_verdict(ALLOW))
    await judge()
    await judge()
    assert len(fake.calls) == 1


async def test_a_different_caption_makes_it_a_different_question(transport) -> None:
    """The caption is part of the moderation context, so it is part of the cache key."""
    fake = transport(media_verdict(ALLOW))
    await judge(caption="")
    await judge(caption="does anyone want to trade")
    assert len(fake.calls) == 2


# ---------------------------------------------------------------------------
# What comes back
# ---------------------------------------------------------------------------
async def test_audio_comes_back_with_a_transcript(transport) -> None:
    transport(
        media_verdict(
            ALLOW,
            transcript="day nine, i got the urge at four and i walked to the park",
            description="a short voice note",
        )
    )
    result = await judge(kind="audio", mime_type="audio/webm", data=WEBP_BYTES)
    assert result["transcript"].startswith("day nine")
    assert result["description"] == "a short voice note"


async def test_the_models_words_are_bounded_before_storage(transport) -> None:
    """A long transcript is trimmed here, not at the point it reaches a column."""
    transport(media_verdict(ALLOW, transcript="x" * 9000, description="y" * 3000))
    result = await judge(kind="audio", mime_type="audio/webm", data=WEBP_BYTES)
    assert len(result["transcript"]) <= 4000
    assert len(result["description"]) <= 600


async def test_a_verdict_with_no_transcript_is_still_a_verdict(transport) -> None:
    """A silent clip has nothing to transcribe; that is not a failure."""
    transport(media_verdict(ALLOW, text=json.dumps({"decision": "allow"})))
    result = await judge(kind="audio", mime_type="audio/webm", data=WEBP_BYTES)
    assert result["decision"] == "allow"
    assert result["transcript"] == ""


# ---------------------------------------------------------------------------
# The endpoint: what it accepts, and what it does with no verdict
# ---------------------------------------------------------------------------
TOKEN = "test-token"
PNG = PNG_BYTES


def upload_headers(kind: str = "image", mime: str = "image/png", caption: str = ""):
    return {
        "X-API-Token": TOKEN,
        "X-Media-Kind": kind,
        "X-Media-Mime": mime,
        "X-Media-Caption": caption,
    }


@pytest_asyncio.fixture
async def client(monkeypatch):
    gemini.reset_state()
    app.dependency_overrides[get_settings] = lambda: Settings(
        API_TOKEN=TOKEN,
        MODERATION_MODE="gemini",
        GEMINI_API_KEY="test-gemini-key",
        GEMINI_MODEL="gemini-flash-lite-latest",
        GEMINI_MEDIA_MAX_BYTES=4_194_304,
    )
    get_settings.cache_clear()

    def install(*responses) -> ScriptedTransport:
        fake = ScriptedTransport(*responses)
        monkeypatch.setattr(gemini, "_transport", fake)
        return fake

    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            yield c, install
    finally:
        app.dependency_overrides.clear()
        get_settings.cache_clear()
        gemini.reset_state()


async def test_media_requires_token(client) -> None:
    c, _ = client
    response = await c.post(
        "/moderate/media",
        content=PNG,
        headers={"X-Media-Kind": "image", "X-Media-Mime": "image/png"},
    )
    assert response.status_code == 401


async def test_media_returns_the_verdict_and_the_transcript(client) -> None:
    c, install = client
    install(media_verdict(ALLOW, transcript="day nine, i walked to the park"))
    response = await c.post(
        "/moderate/media",
        content=WEBP_BYTES,
        headers=upload_headers("audio", "audio/webm", "my voice note"),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decision"] == "allow"
    assert body["engine"] == "gemini"
    assert body["transcript"].startswith("day nine")
    assert body["request_id"]


async def test_no_verdict_answers_503_so_the_caller_refuses_the_upload(client) -> None:
    """The route cannot say 'allow' here, so it must not say anything permissive."""
    c, install = client
    install(THROTTLED)
    response = await c.post(
        "/moderate/media", content=PNG, headers=upload_headers()
    )
    assert response.status_code == 503


@pytest.mark.parametrize(
    "headers",
    [
        upload_headers("document", "application/pdf"),
        upload_headers("image", "application/pdf"),
        upload_headers("image", "text/html"),
        upload_headers("audio", "image/png"),
        {"X-API-Token": TOKEN},
    ],
    ids=["unknown_kind", "pdf_as_image", "html_as_image", "mime_kind_mismatch", "no_kind"],
)
async def test_the_kind_and_mime_allowlist_is_checked_before_any_model_call(
    client, headers
) -> None:
    c, install = client
    fake = install(media_verdict(ALLOW))
    response = await c.post("/moderate/media", content=PNG, headers=headers)
    assert response.status_code == 422
    assert fake.calls == [], "an unaccepted type must not reach the model"


async def test_an_empty_body_is_refused(client) -> None:
    c, install = client
    fake = install(media_verdict(ALLOW))
    response = await c.post("/moderate/media", content=b"", headers=upload_headers())
    assert response.status_code == 422
    assert fake.calls == []


async def test_an_oversized_body_is_refused_before_the_model(client) -> None:
    c, install = client
    app.dependency_overrides[get_settings] = lambda: Settings(
        API_TOKEN=TOKEN,
        MODERATION_MODE="gemini",
        GEMINI_API_KEY="test-gemini-key",
        GEMINI_MEDIA_MAX_BYTES=16,
    )
    fake = install(media_verdict(ALLOW))
    response = await c.post("/moderate/media", content=PNG, headers=upload_headers())
    assert response.status_code == 413
    assert fake.calls == []


async def test_the_caption_is_trimmed_so_it_cannot_smuggle_a_whole_post(client) -> None:
    c, install = client
    install(media_verdict(ALLOW))
    await c.post(
        "/moderate/media",
        content=PNG,
        headers=upload_headers(caption="x" * 9000),
    )
    from app.moderation import gemini as g

    prompt = g._transport.calls[0]["body"]["contents"][0]["parts"][0]["text"]
    tail = prompt[len(g._MEDIA_PROMPT) :]
    assert len(tail) <= 2000

