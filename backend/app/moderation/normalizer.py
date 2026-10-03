"""Text normalisation for moderation.

People evade keyword filters by writing "p o r n", "p.o.r.n", "p0rn",
"pr0n", zero-width-joined words, or with Cyrillic lookalike letters. This
module folds all of that back down to plain text before matching.
"""

from __future__ import annotations

import re
import unicodedata

# Zero-width and invisible formatting characters.
_INVISIBLE = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad]")

# Arabic tatweel (kashida) and combining marks used to stretch words out.
_ARABIC_TATWEEL = "\u0640"
_ARABIC_MARKS = re.compile(r"[\u064b-\u0652\u0670\u06d6-\u06ed]")

# Latin combining marks, after NFKD.
_COMBINING = re.compile(r"[\u0300-\u036f]")

# Characters people substitute for letters, in either direction.
_LEET = str.maketrans(
    {
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "7": "t",
        "8": "b",
        "9": "g",
        "@": "a",
        "$": "s",
        "!": "i",
        "|": "l",
        "+": "t",
    }
)

# Cyrillic and Greek lookalikes mapped onto Latin.
_HOMOGLYPHS = {
    "\u0430": "a", "\u0435": "e", "\u043e": "o",
    "\u0440": "p", "\u0441": "c", "\u0443": "y",
    "\u0456": "i", "\u0458": "j", "\u04bb": "h",
    "\u03bf": "o", "\u03b1": "a", "\u03b5": "e",
    "\u03c1": "p", "\u03c5": "u", "\u03bd": "v",
    "\u04cf": "l", "\u0261": "g",
}

_SEPARATORS = re.compile(r"[\s._\-*+~`'\"^|/\\]+")
_NON_ALNUM = re.compile(r"[^0-9a-z\u0600-\u06ff]+")
_REPEATS = re.compile(r"(.)\1{2,}")
_REPEATS_ALL = re.compile(r"(.)\1+")
_URL = re.compile(
    r"(?:https?://|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|ru|xyz|top|tk|cc|link|shop|live)\b",
    re.IGNORECASE,
)


def normalize(text: str) -> str:
    """Fold text down to a canonical lowercase form.

    Strips invisible characters and diacritics, converts lookalikes and
    leetspeak, then removes separators and collapses repeated letters.
    """
    if not text:
        return ""

    out = unicodedata.normalize("NFKC", text)
    out = _INVISIBLE.sub("", out)
    out = out.replace(_ARABIC_TATWEEL, "")
    out = _ARABIC_MARKS.sub("", out)

    for src, dst in _HOMOGLYPHS.items():
        out = out.replace(src, dst)
        out = out.replace(src.upper(), dst.upper())

    # NFKD splits accents into combining marks so they can be stripped.
    out = unicodedata.normalize("NFKD", out)
    out = _COMBINING.sub("", out)

    out = out.casefold()
    out = out.translate(_LEET)

    # "p.o.r.n" / "p o r n" / "p-o-r-n" all collapse to "porn".
    out = _SEPARATORS.sub("", out)
    out = _NON_ALNUM.sub("", out)

    # "poooorn" -> "poorn" -> still fine, but bound the run length.
    out = _REPEATS.sub(r"\1\1", out)
    return out


def squeeze(text: str) -> str:
    """Collapse repeated characters all the way down: "poooorn" -> "porn".

    Used as a secondary matching pass. `normalize` stops at two repeats
    because collapsing further would mangle ordinary words ("cool" -> "col"),
    but "p o o o r n" is a deliberate evasion that only the squeezed form
    catches.
    """
    return _REPEATS_ALL.sub(r"\1", text)


def soft_normalize(text: str) -> str:
    """Readable lowercase with spaces preserved, for keyword-in-context checks."""
    out = unicodedata.normalize("NFKC", text or "")
    out = _INVISIBLE.sub("", out)
    out = out.replace(_ARABIC_TATWEEL, "")
    out = _ARABIC_MARKS.sub("", out)
    for src, dst in _HOMOGLYPHS.items():
        out = out.replace(src, dst)
    out = unicodedata.normalize("NFKD", out)
    out = _COMBINING.sub("", out)
    out = out.casefold()
    return re.sub(r"\s+", " ", out).strip()


def find_urls(text: str) -> list[str]:
    return _URL.findall(text or "")


def char_ratio(text: str) -> float:
    """Fraction of characters that are letters or digits.

    Heavily obfuscated spam tends to score low. Used as a weak signal only.
    """
    if not text:
        return 0.0
    useful = sum(1 for c in text if c.isalnum())
    return useful / len(text)
