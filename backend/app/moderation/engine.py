"""Moderation engine.

Pipeline: normalise -> lexicon match -> recovery-context rescue ->
optional OpenAI second opinion -> decision.

The "recovery-context rescue" step is the important one. Without it, a member
writing "I stopped masturbating after 30 days" would be blocked for the exact
words that show they are getting better.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import time
from collections import OrderedDict
from typing import NamedTuple

import httpx

from app.config import Settings
from app.moderation.lexicon import BLOCK_TERMS, FLAG_TERMS, RECOVERY_SAFE, Term
from app.moderation.normalizer import (
    MASK_SENTINEL,
    char_ratio,
    find_urls,
    normalize,
    normalize_masked,
    squeeze,
)

# Patterns shorter than this cause more false positives than they catch.
_MIN_PATTERN_LEN = 4

# Categories where a recovery frame rescues the message. Encouragement,
# self-harm and solicitation are never rescued: those are about other people
# or about acute risk, not the author's own recovery.
_RESCUABLE = {"explicit", "gambling"}

# Framing that signals the author is talking about their own recovery.
_RECOVERY_FRAMES = (
    "istopped", "stoppedmasturbat", "stoppedporn", "noimages", "nomore",
    "daysince", "daysclean", "pornfree", "nofap", "sobrietyday",
    "addictedto", "myaddiction", "quitting", "iquit", "relapse",
    "recovered", "recovery", "cleanstreak", "backontrack", "slipped",
    "usedto", "havenot", "notanymore", "freeof",
    # Arabic frames, and unlike the lexicon these are NOT passed through
    # normalize() -- they are matched against text that already is. So they are
    # written pre-folded (no hamza, ة as ه) and pre-collapsed (no spaces),
    # exactly the way normalize() would render them. Without these, an Arabic
    # member disclosing a relapse while asking where to buy material gets a
    # hard block instead of reaching a moderator, which is the one outcome this
    # engine is designed never to produce.
    "انتكست", "انتكاسه", "ادماني", "ادمنت", "مدمن", "تعافي",
    "توقفت", "بطلت", "باقلع", "ايامنظيفه", "نظيف", "نضيف", "مصحه",
    "علاج", "كنت", "مشبتفرج", "مبقتش", "رجعتتاني", "ساعدوني",
    "محتاجمساعده", "بقيتنظيف", "سبتالاباحيه",
)


class _BoundedCache:
    """Tiny LRU so repeated messages skip the network entirely."""

    def __init__(self, capacity: int = 2048) -> None:
        self._data: OrderedDict[str, dict] = OrderedDict()
        self._capacity = capacity

    def get(self, key: str) -> dict | None:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def set(self, key: str, value: dict) -> None:
        self._data[key] = value
        self._data.move_to_end(key)
        while len(self._data) > self._capacity:
            self._data.popitem(last=False)


_openai_cache = _BoundedCache()


class _Pattern(NamedTuple):
    """A compiled term: the plain normalised form and the mask-tolerant regex."""

    text: str
    masked: re.Pattern[str]
    category: str


def _masked_regex(pattern: str) -> re.Pattern[str]:
    """Compile a regex in which any one character may be a masking run.

    "يا ابن كل*" normalises (with stars preserved) to "ياابنكل<mask>", so the
    pattern's final letter has to be allowed to match a run of sentinels.
    Each other character must still match itself, which is what keeps a bare
    "كل" -- a real word -- from matching on its own.
    """
    return re.compile(
        "".join(f"(?:{re.escape(c)}|{MASK_SENTINEL}+)" for c in pattern)
    )


def _prepare(terms: list[Term]) -> list[_Pattern]:
    out: list[_Pattern] = []
    for term in terms:
        pattern = normalize(term.pattern)
        if len(pattern) >= _MIN_PATTERN_LEN:
            out.append(_Pattern(pattern, _masked_regex(pattern), term.category))
    return out


_BLOCK_PATTERNS = _prepare(BLOCK_TERMS)
_FLAG_PATTERNS = _prepare(FLAG_TERMS)
_SAFE_PATTERNS = {normalize(w) for w in RECOVERY_SAFE if normalize(w)}
_FRAME_PATTERNS = [(f, _masked_regex(f)) for f in _RECOVERY_FRAMES]


def _match(
    patterns: list[_Pattern],
    text: str,
    squeezed: str,
    masked: str,
    masked_squeezed: str,
) -> tuple[list[str], set[str]]:
    """Match against the normalised text and three evasions of it.

    The squeeze pass catches character-stuffing ("p o o o r n" -> "pooorn" ->
    "porn"); the masked forms catch a letter hidden behind "*", which plain
    normalisation erases ("كل*" -> "كل").
    """
    hits: list[str] = []
    cats: set[str] = set()
    for pattern in patterns:
        if (
            pattern.text in text
            or pattern.text in squeezed
            or pattern.masked.search(masked)
            or pattern.masked.search(masked_squeezed)
        ):
            hits.append(pattern.text)
            cats.add(pattern.category)
    return hits, cats


def _has_recovery_frame(text: str, masked: str) -> bool:
    if any(frame in text for frame in _RECOVERY_FRAMES):
        return True
    # A member can mask a letter in their own disclosure too ("انتك*ت"), and a
    # rescue that fails to fire is the one failure this engine must not have.
    return any(rx.search(masked) for _, rx in _FRAME_PATTERNS)


async def _openai_verdict(content: str, settings: Settings) -> dict | None:
    """Second opinion from OpenAI. Returns None on any failure or timeout."""
    key = hashlib.sha256(f"{settings.openai_model}:{content}".encode()).hexdigest()
    cached = _openai_cache.get(key)
    if cached is not None:
        return cached

    url = "https://api.openai.com/v1/moderations"
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.openai_model,
        "input": content,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.openai_timeout_seconds) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            result = response.json()["results"][0]
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        # Fail open to the lexicon verdict, never the other way round.
        return None

    flagged = bool(result.get("flagged"))
    categories = [
        name
        for name, hit in result.get("categories", {}).items()
        if hit
    ]
    verdict = {"flagged": flagged, "categories": categories}
    _openai_cache.set(key, verdict)
    return verdict


async def moderate(content: str, settings: Settings) -> dict:
    """Score a message. Returns a dict matching ModerateResponse."""
    started = time.perf_counter()
    text = normalize(content)
    squeezed = squeeze(text)
    masked = normalize_masked(content)
    masked_squeezed = squeeze(masked)

    block_hits, block_cats = _match(
        _BLOCK_PATTERNS, text, squeezed, masked, masked_squeezed
    )
    flag_hits, flag_cats = _match(
        _FLAG_PATTERNS, text, squeezed, masked, masked_squeezed
    )

    decision = "allow"
    severity = "info"
    categories: set[str] = set()
    matched: list[str] = []

    if block_hits:
        rescuable = block_cats <= _RESCUABLE and _has_recovery_frame(text, masked)
        if rescuable:
            decision = "flag"
            severity = "warning"
            categories |= block_cats
            matched += block_hits
        else:
            decision = "block"
            severity = "critical" if "self_harm" in block_cats else "warning"
            categories |= block_cats
            matched += block_hits

    if decision != "block" and flag_hits:
        decision = "flag"
        severity = "warning"
        categories |= flag_cats
        matched += flag_hits

    # Unvetted outbound links are always worth a human glance.
    urls = find_urls(content)
    if urls and decision == "allow":
        decision = "flag"
        severity = "warning"
        categories.add("external_link")

    # Low information content: a wall of symbols or a bare link.
    if decision == "allow" and len(text) >= 8 and char_ratio(content) < 0.55:
        decision = "flag"
        severity = "info"
        categories.add("low_information")

    engine = "lexicon"

    if settings.openai_enabled and decision in {"flag", "block"}:
        score = 1.0 if decision == "block" else 0.5
        if score >= settings.hybrid_escalate_score:
            verdict = await _openai_verdict(content, settings)
            if verdict is not None:
                engine = "hybrid"
                categories |= {c for c in verdict["categories"] if verdict["categories"]}
                if verdict["flagged"]:
                    decision = "block"
                    severity = "critical"
                    categories.add("model")
                elif decision == "block":
                    # Lexicon said block, model did not. Release it.
                    decision = "flag"
                    severity = "warning"
                    categories.add("model_overrode")

    latency_ms = round((time.perf_counter() - started) * 1000, 2)

    return {
        "decision": decision,
        "severity": severity,
        "categories": sorted(categories),
        "matched_terms": sorted(set(matched)),
        "reason": _explain(decision, categories),
        "engine": engine,
        "latency_ms": latency_ms,
    }


def _explain(decision: str, categories: set[str]) -> str:
    if decision == "allow":
        return "No policy violation detected."
    pretty = ", ".join(sorted(categories)) or "policy"
    verb = "Blocked" if decision == "block" else "Held for review"
    return f"{verb}: {pretty}."


async def warm_up() -> None:
    """Preload the compiled pattern sets so the first real request is fast."""
    await asyncio.sleep(0)
