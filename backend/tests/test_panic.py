import pytest

from app.crisis.responder import build_panic_response


def _resp(urge: int, pref: str | None = "general", streak: int = 5):
    return build_panic_response(
        urge_level=urge,
        preference_type=pref,
        current_streak=streak,
        timezone="UTC",
        trigger=None,
    )


@pytest.mark.parametrize("urge", range(0, 11))
async def test_every_urge_level_returns_a_response(urge: int) -> None:
    result = _resp(urge)
    assert result.response
    assert len(result.steps) >= 2
    assert len(result.grounding) == 4
    assert result.urge_level == urge


@pytest.mark.parametrize("pref", ["islamic", "christian", "general", None])
async def test_every_preference_gets_a_reflection(pref: str | None) -> None:
    result = _resp(6, pref)
    joined = " ".join(s.title + s.detail for s in result.steps)
    assert "read one" in joined.lower()


async def test_escalation_threshold() -> None:
    assert _resp(0).escalate_to_admins is False
    assert _resp(4).escalate_to_admins is False
    assert _resp(7).escalate_to_admins is True
    assert _resp(10).escalate_to_admins is True


async def test_high_urgency_names_emergency_services() -> None:
    result = _resp(10)
    text = " ".join(s.title + " " + s.detail for s in result.steps).lower()
    assert "emergency" in text
    assert "crisis line" in text


async def test_streak_appears_when_it_matters() -> None:
    result = build_panic_response(
        urge_level=3,
        preference_type="general",
        current_streak=30,
        timezone="UTC",
        trigger=None,
    )
    assert "day 30" in result.response


async def test_trigger_is_named_first() -> None:
    result = build_panic_response(
        urge_level=8,
        preference_type="general",
        current_streak=10,
        timezone="UTC",
        trigger="loneliness",
    )
    assert "loneliness" in result.steps[0].detail


async def test_urgency_language_escalates() -> None:
    low = _resp(2)
    high = _resp(9)
    assert len(high.steps) > len(low.steps)
    assert high.response != low.response
    # The crisis copy should read as an instruction, not as reassurance.
    assert "stay with me" in high.response.lower()


async def test_cache_key_is_stable_and_distinct() -> None:
    a = build_panic_response(
        urge_level=5, preference_type="general",
        current_streak=7, timezone="UTC", trigger=None,
    )
    b = build_panic_response(
        urge_level=5, preference_type="general",
        current_streak=7, timezone="UTC", trigger=None,
    )
    c = build_panic_response(
        urge_level=8, preference_type="general",
        current_streak=7, timezone="UTC", trigger=None,
    )
    assert a.cache_key == b.cache_key
    assert a.cache_key != c.cache_key


async def test_bad_timezone_does_not_crash() -> None:
    result = build_panic_response(
        urge_level=5, preference_type="islamic",
        current_streak=2, timezone="Not/AZone", trigger=None,
    )
    assert result.response


async def test_no_scripture_is_ever_quoted() -> None:
    """We must never fabricate a verse. Reflections only."""
    for pref in ("islamic", "christian"):
        result = _resp(7, pref)
        blob = " ".join(s.title + s.detail for s in result.steps).lower()
        for marker in ("quran 2:", "john 3:", "verse", "surah"):
            assert marker not in blob