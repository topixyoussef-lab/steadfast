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
import time
from collections import OrderedDict

import httpx

from app.config import Settings
from app.moderation.lexicon import BLOCK_TERMS, FLAG_TERMS, RECOVERY_SAFE, Term
from app.moderation.normalizer import char_ratio, find_urls, normalize, squeeze

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


def _prepare(terms: list[Term]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for term in terms:
        pattern = normalize(term.pattern)
        if len(pattern) >= _MIN_PATTERN_LEN:
            out.append((pattern, term.category))
    return out


_BLOCK_PATTERNS = _prepare(BLOCK_TERMS)
_FLAG_PATTERNS = _prepare(FLAG_TERMS)
_SAFE_PATTERNS = {normalize(w) for w in RECOVERY_SAFE if normalize(w)}


def _match(
    patterns: list[tuple[str, str]],
    text: str,
    squeezed: str,
) -> tuple[list[str], set[str]]:
    """Match against the normalised text, then the squeezed text.

    The second pass catches character-stuffing evasions that the primary
    pass cannot see: "p o o o r n" normalises to "pooorn", which does not
    contain "porn", but squeezing it does.
    """
    hits: list[str] = []
    cats: set[str] = set()
    for pattern, category in patterns:
        if pattern in text or pattern in squeezed:
            hits.append(pattern)
            cats.add(category)
    return hits, cats


def _has_recovery_frame(text: str) -> bool:
    return any(frame in text for frame in _RECOVERY_FRAMES)


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

    block_hits, block_cats = _match(_BLOCK_PATTERNS, text, squeezed)
    flag_hits, flag_cats = _match(_FLAG_PATTERNS, text, squeezed)

    decision = "allow"
    severity = "info"
    categories: set[str] = set()
    matched: list[str] = []

    if block_hits:
        rescuable = block_cats <= _RESCUABLE and _has_recovery_frame(text)
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
