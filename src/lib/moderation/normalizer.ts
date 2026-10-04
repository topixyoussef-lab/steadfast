/**
 * Text normalisation for moderation — a TypeScript port of
 * backend/app/moderation/normalizer.py.
 *
 * People evade keyword filters by writing "p o r n", "p.o.r.n", "p0rn",
 * zero-width-joined words, or with Cyrillic lookalike letters. This module
 * folds all of that back down to plain text before matching. The two
 * implementations must stay behaviour-identical: the routes run this one,
 * the Python service re-checks escalated messages with its own copy.
 */

export const MASK_SENTINEL = "\u0001";

// A masking character is evidence, not punctuation. A separator *between*
// letters can be dropped ("ك_لب" still reads "كلب"), but "*" in "كل*" *replaces*
// a letter: deleting it like a separator erases the only sign that "كلب" was
// hidden and leaves the harmless word "كل" behind. normalizeMasked() swaps
// masking characters for a sentinel that survives both removal passes, so the
// matcher can still tell that something was hidden. The sentinel is a control
// character, so nobody types one by accident.
export const MASK_CHARS = ["*", "٭"] as const;

const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u00ad]/g;

const ARABIC_TATWEEL = "ـ";
const ARABIC_MARKS = /[\u064b-\u0652\u0670\u06d6-\u06ed]/g;

// Arabic letter variants that are spelling differences, not word differences.
// Typing hamza and the round-ta is optional and inconsistent, so "الإباحية" and
// "الاباحية" are the same word to a reader but not to a substring match.
const ARABIC_FOLD: Record<string, string> = {
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
  "ى": "ي",
  "ة": "ه",
  "ؤ": "و",
  "ئ": "ي",
};

const COMBINING = /[\u0300-\u036f]/g;

// Characters people substitute for letters, in either direction.
const LEET: Record<string, string> = {
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
};

// Cyrillic and Greek lookalikes mapped onto Latin (uppercase included so the
// fold works no matter when case folding happens).
const HOMOGLYPHS: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y",
  "і": "i", "ј": "j", "һ": "h",
  "А": "A", "Е": "E", "О": "O", "Р": "P", "С": "C", "У": "Y",
  "І": "I", "Ј": "J", "Һ": "H",
  "ο": "o", "α": "a", "ε": "e", "ρ": "p", "υ": "u", "ν": "v",
  "Ο": "O", "Α": "A", "Ε": "E", "Ρ": "P", "Υ": "U", "Ν": "V",
  "ӏ": "l", "ɡ": "g",
};

// Arabic comma/semicolon/question mark and the Arabic numeric signs live in the
// Arabic block, so NON_ALNUM keeps them; they must be stripped here or
// a comma-separated insult stops matching its spaced-out pattern.
const SEPARATORS = /[\s._\-*+~`'"^|/\\\u0609-\u060c\u061b\u061f\u066a-\u066d]+/g;
const NON_ALNUM = /[^0-9a-z\u0600-\u06ff]+/g;

const NON_ALNUM_MASKED = /[^0-9a-z\u0600-\u06ff\x01]+/g;
const REPEATS = /(.)\1{2,}/g;
const REPEATS_ALL = /(.)\1+/g;

// "me" and "ly" are in the TLD list because of link shorteners and messenger
// deep links (t.me, wa.me, bit.ly) — the main funnels off the platform.
const URL = /(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|ru|xyz|top|tk|cc|link|shop|live|me|ly)\b/gi;

function translate(text: string, map: Record<string, string>): string {
  let out = "";
  for (const ch of text) {
    out += map[ch] ?? ch;
  }
  return out;
}

function fold(text: string): string {
  /** The prefix every normaliser shares: invisibles, diacritics, Arabic
   * letter variants, lookalikes, leetspeak.
   *
   * The callers differ about separators (and masking characters), so those
   * passes stay out of here.
   */
  let out = text.normalize("NFKC");
  out = out.replace(INVISIBLE, "");
  out = out.split(ARABIC_TATWEEL).join("");
  out = out.replace(ARABIC_MARKS, "");
  out = translate(out, ARABIC_FOLD);

  for (const [src, dst] of Object.entries(HOMOGLYPHS)) {
    out = out.split(src).join(dst);
  }

  // NFKD splits accents into combining marks so they can be stripped.
  out = out.normalize("NFKD");
  out = out.replace(COMBINING, "");

  out = out.toLowerCase();
  out = translate(out, LEET);
  return out;
}

export function normalize(text: string): string {
  /** Fold text down to a canonical lowercase form.
   *
   * Strips invisible characters and diacritics, converts lookalikes and
   * leetspeak, then removes separators and collapses repeated letters.
   */
  if (!text) return "";

  // "p.o.r.n" / "p o r n" / "p-o-r-n" all collapse to "porn".
  let out = fold(text).replace(SEPARATORS, "");
  out = out.replace(NON_ALNUM, "");

  // "poooorn" -> "poorn" -> still fine, but bound the run length.
  return out.replace(REPEATS, "$1$1");
}

export function normalizeMasked(text: string): string {
  /** normalize(), except masking characters survive as MASK_SENTINEL.
   *
   * Both forms are needed. normalize() erases the star in "يا ابن كل*" and
   * with it the evidence; this one keeps the star so the matcher can tell the
   * deliberately hidden word apart from the innocent word left behind.
   */
  if (!text) return "";

  let out = fold(text);
  for (const ch of MASK_CHARS) {
    out = out.split(ch).join(MASK_SENTINEL);
  }
  out = out.replace(SEPARATORS, "");
  out = out.replace(NON_ALNUM_MASKED, "");
  return out.replace(REPEATS, "$1$1");
}

export function squeeze(text: string): string {
  /** Collapse repeated characters all the way down: "poooorn" -> "porn".
   *
   * Used as a secondary matching pass. `normalize` stops at two repeats
   * because collapsing further would mangle ordinary words ("cool" -> "col"),
   * but "p o o o r n" is a deliberate evasion that only the squeezed form
   * catches.
   */
  return text.replace(REPEATS_ALL, "$1");
}

export function findUrls(text: string): string[] {
  return text ? (text.match(URL) ?? []) : [];
}

const ALNUM = /[\p{L}\p{N}]/u;

export function charRatio(text: string): number {
  /** Fraction of characters that are letters or digits.
   *
   * Heavily obfuscated spam tends to score low. Used as a weak signal only.
   */
  if (!text) return 0;
  let useful = 0;
  for (const ch of text) {
    if (ALNUM.test(ch)) useful += 1;
  }
  return useful / text.length;
}
