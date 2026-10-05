/**
 * Moderation engine — TypeScript port of backend/app/moderation/engine.py.
 *
 * Pipeline: normalise -> lexicon match -> recovery-context rescue -> decision.
 * The optional model second opinion stays on the Python service and is
 * consulted by `moderateChatContent` only when the local verdict is not
 * "allow" — the common case (a clean message) never touches the network,
 * which is what removes the per-message HTTPS + serverless cold-start latency.
 *
 * The "recovery-context rescue" step is the important one. Without it, a
 * member writing "I stopped masturbating after 30 days" would be blocked for
 * the exact words that show they are getting better.
 */

import {
  MASK_SENTINEL,
  charRatio,
  findUrls,
  normalize,
  normalizeMasked,
  squeeze,
} from "./normalizer";
import { BLOCK_TERMS, FLAG_TERMS, Term } from "./lexicon";

// Patterns shorter than this cause more false positives than they catch.
const MIN_PATTERN_LEN = 4;

// Categories where a recovery frame rescues the message. Encouragement,
// self-harm and solicitation are never rescued: those are about other people
// or about acute risk, not the author's own recovery.
const RESCUABLE = new Set(["explicit", "gambling"]);

// Framing that signals the author is talking about their own recovery.
// Unlike the lexicon these are NOT passed through normalize() — they are
// matched against text that already is. So they are written pre-folded (no
// hamza, ة as ه) and pre-collapsed (no spaces), exactly the way normalize()
// would render them. Without these, an Arabic member disclosing a relapse
// while asking where to buy material gets a hard block instead of reaching a
// moderator, which is the one outcome this engine is designed never to
// produce.
const RECOVERY_FRAMES: string[] = [
  "istopped", "stoppedmasturbat", "stoppedporn", "noimages", "nomore",
  "daysince", "daysclean", "pornfree", "nofap", "sobrietyday",
  "addictedto", "myaddiction", "quitting", "iquit", "relapse",
  "recovered", "recovery", "cleanstreak", "backontrack", "slipped",
  "usedto", "havenot", "notanymore", "freeof",
  "انتكست", "انتكاسه", "ادماني", "ادمنت", "مدمن", "تعافي",
  "توقفت", "بطلت", "باقلع", "ايامنظيفه", "نظيف", "نضيف", "مصحه",
  "علاج", "كنت", "مشبتفرج", "مبقتش", "رجعتتاني", "ساعدوني",
  "محتاجمساعده", "بقيتنظيف", "سبتالاباحيه",
];

// Egyptian mobile numbers, with or without the 20 country-code prefix. Tested
// against separator-stripped raw content rather than normalize() output,
// because normalize() leet-folds 0 to "o" and would mangle every number.
const PHONE_RE = /(?:20)?1[0125]\d{8}/;

type CompiledTerm = {
  text: string;
  masked: RegExp;
  category: string;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskedRegex(pattern: string): RegExp {
  // Any one character may be a masking run. "يا ابن كل*" normalises (with
  // stars preserved) to "ياابنكل<mask>", so the pattern's final letter has
  // to be allowed to match a run of sentinels. Each other character must
  // still match itself, which is what keeps a bare "كل" — a real word — from
  // matching on its own.
  const body = Array.from(pattern)
    .map((c) => `(?:${escapeRegExp(c)}|${escapeRegExp(MASK_SENTINEL)}+)`)
    .join("");
  return new RegExp(body);
}

function prepare(terms: Term[]): CompiledTerm[] {
  const out: CompiledTerm[] = [];
  for (const term of terms) {
    const pattern = normalize(term.pattern);
    if (pattern.length >= MIN_PATTERN_LEN) {
      out.push({ text: pattern, masked: maskedRegex(pattern), category: term.category });
    }
  }
  return out;
}

const BLOCK_PATTERNS = prepare(BLOCK_TERMS);
const FLAG_PATTERNS = prepare(FLAG_TERMS);
const FRAME_PATTERNS = RECOVERY_FRAMES.map((f) => ({ text: f, masked: maskedRegex(f) }));

function matchPatterns(
  patterns: CompiledTerm[],
  text: string,
  squeezed: string,
  masked: string,
  maskedSqueezed: string,
): { hits: string[]; cats: Set<string> } {
  // Match against the normalised text and three evasions of it. The squeeze
  // pass catches character-stuffing ("p o o o r n" -> "pooorn" -> "porn");
  // the masked forms catch a letter hidden behind "*", which plain
  // normalisation erases ("كل*" -> "كل").
  const hits: string[] = [];
  const cats = new Set<string>();
  for (const pattern of patterns) {
    if (
      text.includes(pattern.text) ||
      squeezed.includes(pattern.text) ||
      pattern.masked.test(masked) ||
      pattern.masked.test(maskedSqueezed)
    ) {
      hits.push(pattern.text);
      cats.add(pattern.category);
    }
  }
  return { hits, cats };
}

function hasRecoveryFrame(text: string, masked: string): boolean {
  if (RECOVERY_FRAMES.some((frame) => text.includes(frame))) {
    return true;
  }
  // A member can mask a letter in their own disclosure too ("انتك*ت"), and a
  // rescue that fails to fire is the one failure this engine must not have.
  return FRAME_PATTERNS.some((frame) => frame.masked.test(masked));
}

export type LocalVerdict = {
  decision: "allow" | "flag" | "block";
  severity: "info" | "warning" | "critical";
  categories: string[];
  matched_terms: string[];
  reason: string;
  engine: string;
  latency_ms: number;
  // Set only when the verdict was adopted from the Python second opinion.
  request_id?: string;
};

/** Score a message locally, with zero network I/O. */
export function moderate(content: string): LocalVerdict {
  const started = performance.now();
  const text = normalize(content);
  const squeezed = squeeze(text);
  const masked = normalizeMasked(content);
  const maskedSqueezed = squeeze(masked);

  const block = matchPatterns(BLOCK_PATTERNS, text, squeezed, masked, maskedSqueezed);
  const flag = matchPatterns(FLAG_PATTERNS, text, squeezed, masked, maskedSqueezed);

  let decision: LocalVerdict["decision"] = "allow";
  let severity: LocalVerdict["severity"] = "info";
  const categories = new Set<string>();
  const matched: string[] = [];

  if (block.hits.length > 0) {
    const rescuable =
      block.cats.size > 0 &&
      Array.from(block.cats).every((c) => RESCUABLE.has(c)) &&
      hasRecoveryFrame(text, masked);
    if (rescuable) {
      decision = "flag";
      severity = "warning";
      block.cats.forEach((c) => categories.add(c));
      matched.push(...block.hits);
    } else {
      decision = "block";
      severity = block.cats.has("self_harm") ? "critical" : "warning";
      block.cats.forEach((c) => categories.add(c));
      matched.push(...block.hits);
    }
  }

  if (decision !== "block" && flag.hits.length > 0) {
    decision = "flag";
    severity = "warning";
    flag.cats.forEach((c) => categories.add(c));
    matched.push(...flag.hits);
  }

  // Unvetted outbound links are always worth a human glance.
  const urls = findUrls(content);
  if (urls.length > 0 && decision === "allow") {
    decision = "flag";
    severity = "warning";
    categories.add("external_link");
  }

  // Low information content: a wall of symbols or a bare link.
  if (decision === "allow" && text.length >= 8 && charRatio(content) < 0.55) {
    decision = "flag";
    severity = "info";
    categories.add("low_information");
  }

  // A bare phone number in a public room is the opening move of every
  // off-platform funnel, so it gets the same glance as an unvetted link.
  if (decision === "allow") {
    const compact = content.replace(/[\s()+.\-]/g, "");
    if (PHONE_RE.test(compact)) {
      decision = "flag";
      severity = "warning";
      categories.add("offplatform");
    }
  }

  return {
    decision,
    severity,
    categories: Array.from(categories).sort(),
    matched_terms: Array.from(new Set(matched)).sort(),
    reason: explain(decision, categories),
    engine: "lexicon",
    latency_ms: Math.round((performance.now() - started) * 100) / 100,
  };
}

function explain(decision: LocalVerdict["decision"], categories: Set<string>): string {
  if (decision === "allow") {
    return "No policy violation detected.";
  }
  const pretty = Array.from(categories).sort().join(", ") || "policy";
  const verb = decision === "block" ? "Blocked" : "Held for review";
  return `${verb}: ${pretty}.`;
}

/**
 * Local verdict first; the Python service as a second opinion only.
 *
 * A clean message returns after the local lexicon pass alone — no HTTPS
 * round-trip, no Python cold start. When the local verdict is flag or block,
 * the Python service (lexicon + optional model override) is consulted with
 * its usual timeout, and its verdict is adopted only when it is itself not
 * "allow": the TS lexicon is the superset, so a remote "allow" must never
 * release content the local list caught. The model-overrode downgrade still
 * works, because that path returns "flag", which is adopted.
 */
export async function moderateChatContent(
  content: string,
  meta: { userId: string; roomId?: string; preferenceType?: string | null },
): Promise<LocalVerdict> {
  const local = moderate(content);
  if (local.decision === "allow") {
    return local;
  }

  const { moderateMessage } = await import("@/lib/python-client");
  const remote = await moderateMessage(content, {
    userId: meta.userId,
    roomId: meta.roomId,
    preferenceType: meta.preferenceType,
  });

  if (remote && remote.decision !== "allow") {
    return remote;
  }

  return local;
}
