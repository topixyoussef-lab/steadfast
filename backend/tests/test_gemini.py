"""Gemini as the moderator, and the lexicon as the judge when Gemini is not there.

Two properties matter more than the model's accuracy:
  * when the model answers, its verdict is what the member gets;
  * when it does not answer -- throttled, late, safety-filtered, half a sentence
    of prose -- the deterministic lexicon decides, exactly as it did before.
"""

from __future__ import annotations

import json
import time

import httpx
import pytest

from app.config import Settings
from app.moderation import gemini
from app.moderation.engine import moderate

CLEAN = "Day 30 clean and counting."
LEXICON_BLOCK = "here is my pornhub link"

GEMINI_KEY = "test-gemini-key"


def gemini_settings(**overrides) -> Settings:
    values = {
        "API_TOKEN": "test-token",
        "MODERATION_MODE": "gemini",
        "GEMINI_API_KEY": GEMINI_KEY,
        # set explicitly: tests also read backend/.env, and its GEMINI_MODEL
        # must not decide what the suite asserts about the request URL.
        "GEMINI_MODEL": "gemini-flash-lite-latest",
        "GEMINI_TIMEOUT_SECONDS": 2.0,
        "GEMINI_COOLDOWN_SECONDS": 30.0,
    }
    values.update(overrides)
    return Settings(**values)


def verdict_payload(
    decision: str = "allow",
    categories: list[str] | None = None,
    reason: str = "recovery talk",
    *,
    text: str | None = None,
) -> tuple[int, dict]:
    body = (
        text
        if text is not None
        else json.dumps(
            {"decision": decision, "categories": categories or [], "reason": reason}
        )
    )
    return 200, {"candidates": [{"content": {"parts": [{"text": body}]}}]}


NO_CANDIDATES = 200, {"candidates": []}
EMPTY_PARTS = 200, {"candidates": [{"content": {"parts": []}}]}
SAFETY_BLOCK = 200, {"promptFeedback": {"blockReason": "SAFETY"}}
THROTTLED = 429, {"error": {"code": 429, "message": "Resource has been exhausted"}}
OVERLOADED = 503, {"error": {"code": 503, "message": "The model is overloaded"}}


class ScriptedTransport(httpx.AsyncBaseTransport):
    """Replays canned responses, one per call, and records every request."""

    def __init__(self, *responses) -> None:
        self.responses = list(responses)
        self.calls: list[dict] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(
            {
                "url": str(request.url),
                "headers": dict(request.headers),
                "body": json.loads(request.content.decode()),
            }
        )
        outcome = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(outcome, Exception):
            raise outcome
        status_code, payload = outcome
        return httpx.Response(
            status_code,
            json=payload,
            request=httpx.Request("POST", "https://generativelanguage.googleapis.com"),
        )


@pytest.fixture
def transport(monkeypatch):
    """Installs a fake transport; the test calls it with the responses to replay."""
    gemini.reset_state()

    def install(*responses) -> ScriptedTransport:
        fake = ScriptedTransport(*responses)
        monkeypatch.setattr(gemini, "_transport", fake)
        return fake

    yield install
    gemini.reset_state()


# ---------------------------------------------------------------------------
# The model decides
# ---------------------------------------------------------------------------
async def test_model_allow_passes_a_message(transport) -> None:
    transport(verdict_payload("allow", ["recovery_talk"]))
    result = await moderate(CLEAN, gemini_settings())
    assert result["decision"] == "allow"
    assert result["engine"] == "gemini"
    assert "recovery_talk" in result["categories"]


async def test_model_block_stops_a_message_the_lexicon_ignored(transport) -> None:
    transport(verdict_payload("block", ["external_solicitation"], "selling access"))
    result = await moderate("anyone got the link for tonight?", gemini_settings())
    assert result["decision"] == "block"
    assert result["engine"] == "gemini"


async def test_model_block_aimed_at_a_minor_is_critical(transport) -> None:
    transport(verdict_payload("block", ["minor_contact"], "targets a child"))
    result = await moderate("send that to the kids group", gemini_settings())
    assert result["severity"] == "critical"


async def test_model_block_after_a_lexicon_block_stays_lexicon_severity(transport) -> None:
    transport(verdict_payload("block", ["porn_acquisition"], "offers access"))
    result = await moderate(LEXICON_BLOCK, gemini_settings())
    assert result["decision"] == "block"
    # the lexicon's own category set still drives how urgent we call it.
    assert result["severity"] in {"warning", "critical"}


async def test_model_flag_reaches_a_human(transport) -> None:
    transport(verdict_payload("flag", ["unclear_intent"]))
    result = await moderate(CLEAN, gemini_settings())
    assert result["decision"] == "flag"
    assert result["severity"] == "warning"


async def test_model_allow_cannot_silently_release_a_lexicon_block(transport) -> None:
    transport(verdict_payload("allow", ["adult_content"]))
    result = await moderate(LEXICON_BLOCK, gemini_settings())
    assert result["decision"] == "flag", "a model 'allow' must not clear a hard block"
    assert result["severity"] == "warning"
    assert "model_overrode" in result["categories"]
    # what the lexicon matched stays on the record for whoever reviews it.
    assert result["matched_terms"]


async def test_the_model_prose_is_never_shown_to_the_member(transport) -> None:
    transport(verdict_payload("block", ["solicitation"], "offers paid content"))
    result = await moderate("paid videos, message me", gemini_settings())
    assert result["decision"] == "block"
    assert "offers paid content" not in result["reason"]
    assert result["reason"] == f"Blocked: {', '.join(sorted(result['categories']))}."


# ---------------------------------------------------------------------------
# The model is not there: the lexicon decides, as it did before
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "outcome",
    [THROTTLED, OVERLOADED, NO_CANDIDATES, EMPTY_PARTS, SAFETY_BLOCK],
    ids=["429", "503", "no_candidates", "empty_parts", "safety_block"],
)
async def test_unavailable_model_falls_back_to_the_lexicon(transport, outcome) -> None:
    transport(outcome)
    blocked = await moderate(LEXICON_BLOCK, gemini_settings())
    assert blocked["decision"] == "block"
    assert blocked["engine"] == "lexicon"
    passed = await moderate(CLEAN, gemini_settings())
    assert passed["decision"] == "allow"
    assert passed["engine"] == "lexicon"


async def test_unparsable_answer_falls_back_to_the_lexicon(transport) -> None:
    transport(verdict_payload(text="I cannot judge this message, it seems fine."))
    result = await moderate(LEXICON_BLOCK, gemini_settings())
    assert result["decision"] == "block"
    assert result["engine"] == "lexicon"


async def test_a_decision_outside_the_vocabulary_is_no_decision(transport) -> None:
    transport(verdict_payload(text=json.dumps({"decision": "delete_everything"})))
    result = await moderate(LEXICON_BLOCK, gemini_settings())
    assert result["engine"] == "lexicon"
    assert result["decision"] == "block"


async def test_timeout_falls_back_to_the_lexicon(transport) -> None:
    transport(httpx.ReadTimeout("timed out"))
    result = await moderate(LEXICON_BLOCK, gemini_settings())
    assert result["decision"] == "block"
    assert result["engine"] == "lexicon"


async def test_a_failure_stops_asking_the_model_for_a_while(transport) -> None:
    fake = transport(THROTTLED)
    first = await moderate(LEXICON_BLOCK, gemini_settings())
    second = await moderate(CLEAN, gemini_settings())
    assert first["engine"] == second["engine"] == "lexicon"
    # the cooldown means one failed call, not one per message.
    assert len(fake.calls) == 1


async def test_once_the_cooldown_expires_the_model_is_asked_again(
    transport, monkeypatch
) -> None:
    fake = transport(THROTTLED, verdict_payload("allow"))
    await moderate(LEXICON_BLOCK, gemini_settings())
    assert len(fake.calls) == 1

    monkeypatch.setattr(gemini, "_cooldown_until", time.monotonic() - 1)
    result = await moderate(CLEAN, gemini_settings())
    assert len(fake.calls) == 2
    assert result["engine"] == "gemini"


async def test_repeated_content_is_asked_about_once(transport) -> None:
    fake = transport(verdict_payload("block", ["solicitation"]))
    settings = gemini_settings()
    message = "paid videos, message me"
    assert (await moderate(message, settings))["decision"] == "block"
    assert (await moderate(message, settings))["decision"] == "block"
    assert len(fake.calls) == 1


# ---------------------------------------------------------------------------
# What we send
# ---------------------------------------------------------------------------
async def test_request_carries_the_key_in_a_header_and_the_content_in_the_prompt(
    transport,
) -> None:
    fake = transport(verdict_payload("allow"))
    await moderate(CLEAN, gemini_settings())
    call = fake.calls[0]
    assert call["headers"]["x-goog-api-key"] == GEMINI_KEY
    assert call["url"].startswith("https://generativelanguage.googleapis.com/")
    assert call["url"].endswith("gemini-flash-lite-latest:generateContent")
    prompt = call["body"]["contents"][0]["parts"][0]["text"]
    assert prompt.startswith(gemini.PROMPT)
    assert prompt.endswith(CLEAN)
    config = call["body"]["generationConfig"]
    assert config["temperature"] == 0
    assert config["responseMimeType"] == "application/json"


async def test_gemini_mode_does_not_also_escalate_to_openai(transport) -> None:
    fake = transport(verdict_payload("block", ["solicitation"]))
    result = await moderate(
        "paid videos, message me",
        gemini_settings(OPENAI_API_KEY="sk-test-key"),
    )
    assert result["engine"] == "gemini"
    assert len(fake.calls) == 1


async def test_without_the_mode_nothing_is_asked(transport) -> None:
    fake = transport(verdict_payload("block"))
    result = await moderate(
        LEXICON_BLOCK,
        gemini_settings(MODERATION_MODE="lexicon"),
    )
    assert result["engine"] == "lexicon"
    assert result["decision"] == "block"
    assert fake.calls == []
