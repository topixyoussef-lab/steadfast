import { intlLocale, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { RecoveryStage } from "@/lib/types";

/**
 * Mirrors private.local_day() in the migration so the UI and the database
 * agree on what "today" means for a given timezone + cutoff hour.
 *
 * The database stays authoritative for streaks. This is display-only: it
 * differs from the SQL by at most an hour on a DST boundary, which is why
 * nothing security- or streak-critical should read this.
 *
 * The calendar is formatted with a fixed `en-US` skeleton on purpose: we only
 * want the field order (year/month/day), never localised digits, because the
 * result is a `YYYY-MM-DD` key that gets compared against database rows.
 */
export function localDayKey(
  timezone: string,
  cutoffHour: number,
  at: Date = new Date(),
): string {
  const shifted = new Date(at.getTime() - cutoffHour * 3_600_000);
  const skeleton = { year: "numeric", month: "2-digit", day: "2-digit" } as const;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...skeleton })
      .formatToParts(shifted);
  } catch {
    // A row with a timezone the runtime no longer recognises should not take
    // the whole dashboard down. Fall back to UTC, which is what the
    // database column defaults to anyway.
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...skeleton })
      .formatToParts(shifted);
  }

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const MILESTONES = [1, 3, 7, 14, 30, 60, 90, 180, 365] as const;

const MILESTONE_KEY: Record<number, keyof Dictionary["milestones"]> = {
  1: "one",
  3: "three",
  7: "week",
  14: "twoWeeks",
  30: "month",
  60: "twoMonths",
  90: "threeMonths",
  180: "sixMonths",
  365: "year",
};

export function milestoneLabel(days: number, dict: Dictionary): string {
  const key = MILESTONE_KEY[days];
  return key ? dict.milestones[key] : `${dict.milestones.day} ${days}`;
}

export function nextMilestone(streak: number): number | null {
  return MILESTONES.find((m) => m > streak) ?? null;
}

export function progressToMilestone(streak: number): number {
  const next = nextMilestone(streak);
  if (next === null) return 100;
  const previous = [...MILESTONES].reverse().find((m) => m <= streak) ?? 0;
  return Math.round(((streak - previous) / (next - previous)) * 100);
}

export function stageLabel(stage: RecoveryStage, dict: Dictionary): string {
  return dict.stages[stage];
}

export function stageBlurb(stage: RecoveryStage, dict: Dictionary): string {
  return dict.stages[`blurb_${stage}`];
}

export function categoryLabel(
  category: string,
  dict: Dictionary,
): string {
  const known = dict.categories as Record<string, string | undefined>;
  return known[category] ?? category;
}

/** Label for a `job_categories.slug`, falling back to the DB name. */
export function jobCategoryLabel(
  slug: string,
  name: string,
  dict: Dictionary,
): string {
  const known = dict.jobCategories as Record<string, string | undefined>;
  return known[slug] ?? name;
}

export function jobStatusLabel(status: string, dict: Dictionary): string {
  const known = dict.jobStatuses as Record<string, string | undefined>;
  return known[status] ?? status;
}

export function applicationStatusLabel(
  status: string,
  dict: Dictionary,
): string {
  const known = dict.applicationStatuses as Record<string, string | undefined>;
  return known[status] ?? status;
}

/** Weekday initial for the check-in strip, in the member's locale. */
export function weekdayInitial(dayKey: string, locale: Locale): string {
  // Noon avoids any DST/offset edge when converting a bare YYYY-MM-DD.
  const date = new Date(`${dayKey}T12:00:00Z`);
  return new Intl.DateTimeFormat(intlLocale[locale], {
    timeZone: "UTC",
    weekday: "narrow",
  }).format(date);
}

export function moodLabel(mood: number | null, dict: Dictionary): string {
  if (mood === null) return dict.moods.notLogged;
  if (mood >= 8) return dict.moods.strong;
  if (mood >= 6) return dict.moods.good;
  if (mood >= 4) return dict.moods.flat;
  if (mood >= 2) return dict.moods.low;
  return dict.moods.rough;
}

export function urgeLabel(urge: number | null, dict: Dictionary): string {
  if (urge === null) return dict.moods.notLogged;
  if (urge <= 2) return dict.panic.calm;
  if (urge <= 5) return dict.panic.present;
  if (urge <= 7) return dict.panic.strong;
  return dict.panic.overwhelming;
}

/**
 * Stable anonymous handle for a chat author.
 *
 * RLS only lets a member read their own profile row, so the client cannot
 * join chat_messages to profiles to show a display name, and it should not:
 * the community is pseudonymous by design. Hashing the id gives every member
 * the same handle in every room for as long as the account exists, which is
 * what makes a room feel like a room.
 */
export function pseudonym(userId: string, dict: Dictionary): string {
  // FNV-1a, so the handle is deterministic without pulling in a crypto lib.
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${dict.common.member} ${hash.toString(16).toUpperCase().padStart(8, "0").slice(0, 4)}`;
}

/** Minor units to a readable price. Avoids Intl edge cases on bad data. */
export function formatMoney(
  minor: number,
  currency: string,
  type: string,
  dict: Dictionary,
  locale: Locale,
): string {
  if (type === "negotiable") return dict.jobs.negotiable;

  const major = minor / 100;
  try {
    return new Intl.NumberFormat(intlLocale[locale], {
      style: "currency",
      currency,
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

/** Lower-cased urgency word embedded in the panic alert payload. */
export function panicLabel(urge: number | null, dict: Dictionary): string {
  if (urge === null) return dict.panic.unknown;
  if (urge <= 2) return dict.panic.calm;
  if (urge <= 5) return dict.panic.present;
  if (urge <= 7) return dict.panic.strong;
  return dict.panic.overwhelming;
}

export function relativeTime(iso: string, dict: Dictionary, locale: Locale): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return dict.relative.justNow;

  const rtf = new Intl.RelativeTimeFormat(intlLocale[locale], { numeric: "auto" });
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), "hour");
  if (seconds < 604800) return rtf.format(-Math.floor(seconds / 86400), "day");
  return new Date(iso).toISOString().slice(0, 10);
}

export function clockTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(intlLocale[locale], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Full date, optionally with the time.
 *
 * Admin surfaces need an absolute timestamp, not a relative one: "3 days ago"
 * is useless when you are reconstructing what a member did last Tuesday.
 */
export function formatDate(iso: string | null, locale: Locale, withTime = false): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale[locale], {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : null),
  }).format(date);
}