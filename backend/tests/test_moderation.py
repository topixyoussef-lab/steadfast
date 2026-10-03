"""The most important tests in this service.

A recovery community must be able to talk openly about addiction. These tests
fail loudly if a future lexicon edit starts blocking people's disclosures.
"""

import pytest

from app.config import Settings
from app.moderation.engine import moderate
from app.moderation.lexicon import (
    ACQUISITION_TERMS,
    BLOCK_TERMS,
    FLAG_TERMS,
    RECOVERY_SAFE,
)
from app.moderation.normalizer import normalize


# ---------------------------------------------------------------------------
# Recovery disclosures must NOT be blocked
# ---------------------------------------------------------------------------
DISCLOSURES = [
    "I relapsed last night after 12 days.",
    "Day 30 clean and counting.",
    "This porn addiction is destroying my life.",
    "Struggling hard today, the urges are unbearable.",
    "I have a 45 day streak going and I want to keep it.",
    "My triggers are boredom and being alone at night.",
    "I almost gave in but I did not.",
    "I need help, I cannot do this alone.",
    "Quitting porn has been the hardest thing I ever did.",
    "I failed again but I am trying.",
    "Withdrawal hits me every night around 2am.",
    "Going through depression and shame after relapsing.",
    "My sponsor told me to keep going.",
    "I watched porn for two hours and I hate myself.",
    "How do I deal with cravings during Fajr?",
]

# ---------------------------------------------------------------------------
# These must be blocked
# ---------------------------------------------------------------------------
MUST_BLOCK = [
    "here is my pornhub link",
    "add me on telegram for private videos",
    "everyone watches porn, stop pretending",
    "relapse is fine, give in and watch",
    "free casino bonus deposit here",
    "how many pills would I need",
]


async def test_recovery_disclosures_are_never_blocked(settings: Settings) -> None:
    for text in DISCLOSURES:
        result = await moderate(text, settings)
        assert result["decision"] != "block", (
            f"Blocked a recovery disclosure: {text!r} -> {result}"
        )


async def test_encouragement_is_blocked(settings: Settings) -> None:
    for text in MUST_BLOCK:
        result = await moderate(text, settings)
        assert result["decision"] == "block", (
            f"Failed to block: {text!r} -> {result}"
        )


# ---------------------------------------------------------------------------
# Obfuscation must not defeat the filter
# ---------------------------------------------------------------------------
async def test_obfuscated_block_is_caught(settings: Settings) -> None:
    result = await moderate("p o r n h u b", settings)
    assert result["decision"] == "block"


async def test_leetspeak_block_is_caught(settings: Settings) -> None:
    result = await moderate("p0rnhub", settings)
    assert result["decision"] == "block"


async def test_character_stuffing_block_is_caught(settings: Settings) -> None:
    result = await moderate("p o o o r n h u b", settings)
    assert result["decision"] == "block"


async def test_offplatform_solicitation_is_blocked(settings: Settings) -> None:
    result = await moderate("add me on telegram for private videos", settings)
    assert result["decision"] == "block"
    assert "solicitation" in result["categories"]


# ---------------------------------------------------------------------------
# Acquisition intent
#
# The bare noun "porn" cannot be blocked without silencing disclosure, so the
# signal that distinguishes an attack from recovery talk is the intent to buy
# or obtain it. Every obfuscation of the same ask has to be caught.
# ---------------------------------------------------------------------------
ACQUISITION_MUST_BLOCK = [
    "where can i buy porn",
    "where to buy porn",
    "buy porn",
    "where can i buy p o o r n",
    "where can i buy p.o.o.r.n",
    "where can i buy p-o-o-r-n",
    "where can i buy p_o_o_r_n",
    "where can i buy p0rn",
    "where can i buy poooorn",
    "anyone have porn",
    "looking for porn",
    "send me porn",
    "dm me porn",
    "porn for sale",
    "where can i download porn",
]

# Buying things is the point of the jobs board, and recovery members buy
# recovery supplies. These must not become collateral damage.
ACQUISITION_MUST_ALLOW = [
    "where can i buy a rosary",
    "where can i buy methadone",
    "where can i buy naloxone",
    "where can i buy a phone charger",
    "i want to buy a gym membership",
    "any graphic designers here?",
]


async def test_acquisition_intent_is_blocked(settings: Settings) -> None:
    for text in ACQUISITION_MUST_BLOCK:
        result = await moderate(text, settings)
        assert result["decision"] == "block", (
            f"Failed to block an acquisition request: {text!r} -> {result}"
        )


async def test_acquisition_rule_does_not_block_ordinary_purchases(
    settings: Settings,
) -> None:
    for text in ACQUISITION_MUST_ALLOW:
        result = await moderate(text, settings)
        assert result["decision"] != "block", (
            f"Blocked ordinary shopping: {text!r} -> {result}"
        )


async def test_acquisition_inside_recovery_frame_is_flagged_not_blocked(
    settings: Settings,
) -> None:
    """Someone asking for this while in crisis needs a human, not a wall."""
    result = await moderate("i relapsed again, where can i buy porn", settings)
    assert result["decision"] == "flag", (
        f"Should reach a moderator, not be walled off: {result}"
    )


async def test_acquisition_categories_are_rescuable(settings: Settings) -> None:
    """Guards the category split: self-acquisition rescues, luring does not."""
    from app.moderation.engine import _RESCUABLE

    rescuing = {t.category for t in ACQUISITION_TERMS if t.category in _RESCUABLE}
    assert "explicit" in rescuing, (
        "Self-acquisition terms must stay rescuable or crisis messages get blocked"
    )


# ---------------------------------------------------------------------------
# Normal, harmless community chat
# ---------------------------------------------------------------------------
BENIGN = [
    "morning everyone, day 7",
    "any graphic designers here?",
    "what time is Fajr in your timezone?",
    "thanks for the reply, that helped",
    "check this out https://developer.mozilla.org",
    "I finished the book you recommended",
]

async def test_benign_messages_pass(settings: Settings) -> None:
    for text in BENIGN:
        result = await moderate(text, settings)
        assert result["decision"] in {"allow", "flag"}, (
            f"Wrongly held: {text!r} -> {result}"
        )


async def test_external_link_is_flagged_not_blocked(settings: Settings) -> None:
    result = await moderate("look at this https://example.com", settings)
    assert result["decision"] == "flag"
    assert "external_link" in result["categories"]


async def test_explicit_category_rescued_by_recovery_frame(settings: Settings) -> None:
    # Naming the behaviour in a recovery context is allowed.
    text = "I stopped masturbating 20 days ago"
    result = await moderate(text, settings)
    assert result["decision"] != "block"


async def test_encouragement_is_never_rescued(settings: Settings) -> None:
    # Same explicit terms, but framed as encouragement to others.
    text = "I quit porn, now everyone watches porn, stop pretending"
    result = await moderate(text, settings)
    assert result["decision"] == "block"


async def test_self_harm_is_critical(settings: Settings) -> None:
    result = await moderate("I want to die", settings)
    assert result["decision"] == "block"


# ---------------------------------------------------------------------------
# Arabic coverage
#
# The community is Arabic-first. Before these terms existed every message below
# scored "allow", including a suicide statement, so the English suite passing
# said nothing about whether the deployed service could read its own users.
# ---------------------------------------------------------------------------
ARABIC_DISCLOSURES = [
    "أنا مدمن إباحية وبحاول أبطل",
    "انتكست امبارح بعد ١٢ يوم",
    "الشهوة صعبة جدا النهاردة",
    "بطلت العادة السرية من تلاتين يوم",
    "كنت بتفرج على إباحي وأنا صغير",
    "ادمنت الأفلام الإباحية وعايز أتعالج",
    "محفزاتي النهاردة الصلاة والصيام",
    "نفسي أرجع نظيف تاني، ادعولي",
    "أنا حاسس بخجل وذنب بعد الانتكاسة",
    "ساعدوني، الوحدة بتوحش بالليل",
]

ARABIC_MUST_BLOCK = [
    "أموت نفسي",
    "روح موت نفسك يا فاشل",
    "طريقة الانتحار إيه",
    "يا ابن الكلب",
    "يا شرموطة",
    "كل الناس بتتفرج على الإباحية",
    "ضيفني على تليجرام هبعترك صور",
    "كازينو أونلاين رهان مضمون",
    "عايز أفلام إباحية، رابط موقع إباحي",
]


async def test_arabic_recovery_disclosures_are_never_blocked(settings: Settings) -> None:
    for text in ARABIC_DISCLOSURES:
        result = await moderate(text, settings)
        assert result["decision"] != "block", (
            f"Blocked an Arabic recovery disclosure: {text!r} -> {result}"
        )


async def test_arabic_attacks_are_blocked(settings: Settings) -> None:
    for text in ARABIC_MUST_BLOCK:
        result = await moderate(text, settings)
        assert result["decision"] == "block", (
            f"Failed to block: {text!r} -> {result}"
        )


async def test_arabic_self_harm_is_critical(settings: Settings) -> None:
    result = await moderate("أموت نفسي", settings)
    assert result["decision"] == "block"
    assert result["severity"] == "critical"


async def test_arabic_spelling_variance_still_matches(settings: Settings) -> None:
    """Hamza and the round-ta are optional when typing, not when matching."""
    for text in ["الإباحية عادية", "الاباحية عاديه", "الاباحية عادية"]:
        result = await moderate(text, settings)
        assert result["decision"] == "block", f"{text!r} -> {result}"


async def test_arabic_punctuation_does_not_defeat_a_match(settings: Settings) -> None:
    """The observed production message, with and without its punctuation."""
    for text in ["يا كلب", "يا كلب؟", "يا كلب، انت واحد كلب"]:
        result = await moderate(text, settings)
        assert result["decision"] == "flag", f"{text!r} -> {result}"
        assert "harassment" in result["categories"]


async def test_arabic_insult_flags_while_slur_blocks(settings: Settings) -> None:
    """An insult reaches a moderator; a slur does not get posted at all."""
    insult = await moderate("يا غبي", settings)
    assert insult["decision"] == "flag"
    slur = await moderate("يا ابن الكلب", settings)
    assert slur["decision"] == "block"


async def test_arabic_acquisition_in_crisis_is_flagged_not_blocked(
    settings: Settings,
) -> None:
    """Same rescue rule as English: this person needs a human, not a wall."""
    result = await moderate("انتكست امبارح وعايز أفلام إباحية", settings)
    assert result["decision"] == "flag", f"Should reach a moderator: {result}"


async def test_arabic_encouragement_is_never_rescued(settings: Settings) -> None:
    """A recovery frame cannot rescue a message aimed at other people."""
    result = await moderate("أنا بطلت، بس كل الناس بتتفرج عادي", settings)
    assert result["decision"] == "block", f"{result}"


async def test_arabic_offplatform_mention_is_flagged(settings: Settings) -> None:
    result = await moderate("حد عنده جروب واتساب", settings)
    assert result["decision"] == "flag"
    assert "offplatform" in result["categories"]


async def test_ordinary_arabic_chat_passes(settings: Settings) -> None:
    for text in [
        "صباح الخير يا جماعة، يوم سابع",
        "حد يعرف ميكانيكي كويس في القاهرة؟",
        "شكرا على الرد، ده ساعدني فعلا",
        "كلبنا نام جنبى طول الليل",
    ]:
        result = await moderate(text, settings)
        assert result["decision"] in {"allow", "flag"}, f"Wrongly held: {text!r} -> {result}"


# ---------------------------------------------------------------------------
# Structural guarantees
# ---------------------------------------------------------------------------
def test_no_recovery_word_is_also_a_block_term() -> None:
    """A regression guard on the whole design."""
    safe = {normalize(w) for w in RECOVERY_SAFE}
    offending = {
        normalize(t.pattern)
        for t in BLOCK_TERMS
        if normalize(t.pattern) in safe
    }
    assert not offending, f"Recovery vocabulary is in the block list: {offending}"


def test_no_flag_term_is_also_a_block_term() -> None:
    block = {normalize(t.pattern) for t in BLOCK_TERMS}
    clash = {normalize(t.pattern) for t in FLAG_TERMS if normalize(t.pattern) in block}
    assert not clash, f"Terms appear in both lists: {clash}"


def test_every_term_declares_a_known_category() -> None:
    known = {
        "explicit", "solicitation", "encouragement",
        "gambling", "self_harm", "self_hostility",
        "scam", "offplatform", "harassment",
    }
    for term in [*BLOCK_TERMS, *FLAG_TERMS]:
        assert term.category in known, f"{term.pattern} -> {term.category}"
        assert term.severity in {"block", "flag"}


def test_short_patterns_are_dropped_at_load() -> None:
    from app.moderation.engine import _BLOCK_PATTERNS

    assert all(len(p) >= 4 for p, _ in _BLOCK_PATTERNS)