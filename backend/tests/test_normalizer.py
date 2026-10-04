import pytest

from app.moderation.normalizer import (
    MASK_SENTINEL,
    char_ratio,
    find_urls,
    normalize,
    normalize_masked,
    soft_normalize,
    squeeze,
)


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("PORN", "porn"),
        ("p.o.r.n", "porn"),
        ("p o r n", "porn"),
        ("p-o-r-n", "porn"),
        ("p0rn", "porn"),
        ("pr0n", "pr0n".replace("0", "o")),
        ("p@rn", "parn"),
        ("Porn\u200b", "porn"),
        ("\u200bp\u200bo\u200br\u200bn\u200b", "porn"),
        ("pоrn", "porn"),  # Cyrillic o
        ("pоrn", "porn"),  # Latin o, zero-width joiner stripped
    ],
)
def test_obfuscation_is_folded(raw: str, expected: str) -> None:
    assert normalize(raw) == expected


def test_casefold_and_diacritics() -> None:
    assert normalize("PÖRN") == "porn"
    assert normalize("fá cá") == "faca"


def test_arabic_tatweel_stripped() -> None:
    assert normalize("مـكـتـب") == "مكتب"


def test_arabic_letter_variants_are_folded() -> None:
    """Hamza and the round-ta are typing style, not different words."""
    assert normalize("الإباحية") == normalize("الاباحيه")
    assert normalize("أحمد") == normalize("احمد")
    assert normalize("أيام") == normalize("ايام")
    assert normalize("على") == normalize("علي")
    assert normalize("شؤون") == normalize("شوون")
    assert normalize("شيئ") == normalize("شئي")


def test_arabic_punctuation_is_a_separator() -> None:
    """These sit inside \\u0600-\\u06ff, so only the separator pass removes them."""
    assert normalize("يا، كلب") == normalize("يا كلب")
    assert normalize("يا كلب؟") == normalize("يا كلب")
    assert "،" not in normalize("اه، لا")


def test_arabic_folding_does_not_touch_latin() -> None:
    assert normalize("PornHub") == "pornhub"


def test_soft_normalize_keeps_spaces() -> None:
    assert soft_normalize("Hello   World") == "hello world"
    assert soft_normalize("I hate myself") == "i hate myself"


def test_empty_input() -> None:
    assert normalize("") == ""
    assert soft_normalize("") == ""


def test_find_urls() -> None:
    found = find_urls("check https://example.com and bad-site.xyz now")
    assert any("example.com" in u for u in found)
    assert any("bad-site.xyz" in u for u in found)


def test_find_urls_empty() -> None:
    assert find_urls("no links here") == []


def test_char_ratio() -> None:
    assert char_ratio("hello") == 1.0
    assert char_ratio("!!!!!!") == 0.0
    assert 0 < char_ratio("a!!!b") < 1


def test_normalize_keeps_one_repeat_squeeze_removes_all() -> None:
    # "cool" must survive, so normalize stops at two repeats.
    assert normalize("cool") == "cool"
    assert squeeze("cool") == "col"
    # Character stuffing is only caught by the squeeze pass.
    assert normalize("poooorn") == "poorn"
    assert squeeze("poooorn") == "porn"


def test_squeeze_empty() -> None:
    assert squeeze("") == ""


def test_normalize_masked_keeps_the_star() -> None:
    """The star replaces a letter, so it is evidence and must not be deleted."""
    assert normalize("انت ابن كل*") == "انتابنكل"
    assert normalize_masked("انت ابن كل*") == "انتابنكل" + MASK_SENTINEL


def test_normalize_masked_collapses_star_runs_like_repeats() -> None:
    assert normalize_masked("كل***") == "كل" + MASK_SENTINEL * 2
    assert squeeze(normalize_masked("كل***")) == "كل" + MASK_SENTINEL


def test_normalize_masked_keeps_the_arabic_star() -> None:
    # U+066D sits inside \u0600-\u06ff and would otherwise be deleted as
    # punctuation, silently turning a masked letter into a clean word.
    assert normalize_masked("كل\u066d") == "كل" + MASK_SENTINEL


def test_normalize_masked_equals_normalize_without_masks() -> None:
    for text in ["يا ابن الكلب", "الإباحية عادية", "p.o.r.n", "p0rn"]:
        assert normalize_masked(text) == normalize(text)