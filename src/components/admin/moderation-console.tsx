"use client";

import { useMemo, useState } from "react";

import { LogRowActions, MessageActions } from "@/components/admin/admin-actions";
import { Badge, EmptyNote, Section } from "@/components/admin/dossier-ui";
import { SearchIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import {
  alertSeverityLabel,
  moderationStatusLabel,
  relativeTime,
} from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/interpolate";
import type { Locale } from "@/lib/i18n/config";

export type FlaggedMessage = {
  id: string;
  room_id: string;
  user_id: string;
  content: string;
  moderation_status: string;
  created_at: string;
};

export type LogRow = {
  /** bigserial, so a string rather than a uuid. */
  id: string;
  user_id: string;
  room_id: string | null;
  content_preview: string | null;
  status: string;
  severity: string;
  categories: string[] | null;
  matched_terms: string[] | null;
  latency_ms: number | null;
  created_at: string;
};

/**
 * A message has to clear both lists to show up under a filter: a status chip
 * picks the verdict, the search box picks the words. Both are browser-side on
 * purpose, matching the member directory, because each list is already capped
 * server side and the point is to narrow a known set without a round trip.
 */
type StatusFilter = "all" | "allowed" | "flagged" | "blocked";

const STATUS_FILTERS: StatusFilter[] = ["all", "allowed", "flagged", "blocked"];

function matches(
  row: { content: string | null } | { content_preview: string | null },
  needle: string,
): boolean {
  if (!needle) return true;
  const text = "content" in row ? row.content : row.content_preview;
  return text?.toLowerCase().includes(needle) ?? false;
}

function matchesCategories(
  row: { categories: string[] | null; matched_terms: string[] | null },
  needle: string,
): boolean {
  if (!needle) return true;
  return [...(row.categories ?? []), ...(row.matched_terms ?? [])].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

/** One status chip plus its own row count, so staff can see where the volume is. */
function Chip({
  active,
  label,
  count,
  onClick,
  tone,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  tone?: "danger" | "warning" | "good";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition",
        active
          ? "border-accent bg-accent text-accent-contrast"
          : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] tabular-nums",
          active ? "bg-black/10" : tone === "danger" && "bg-danger-soft text-danger",
          tone === "warning" && "bg-warning/15 text-warning",
          tone === "good" && "bg-accent-soft text-accent",
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function ModerationConsole({
  flagged,
  log,
  dict,
  locale,
}: {
  flagged: FlaggedMessage[];
  log: LogRow[];
  dict: Dictionary;
  locale: Locale;
}) {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();

  const counts = useMemo(() => {
    const base = { all: log.length, allowed: 0, flagged: 0, blocked: 0 };
    for (const row of log) {
      if (row.status === "allowed") base.allowed += 1;
      else if (row.status === "flagged") base.flagged += 1;
      else if (row.status === "blocked") base.blocked += 1;
    }
    return base;
  }, [log]);

  const visibleFlagged = useMemo(
    () =>
      flagged.filter(
        (message) =>
          (status === "all" || message.moderation_status === status) &&
          matches(message, needle),
      ),
    [flagged, status, needle],
  );

  const visibleLog = useMemo(
    () =>
      log.filter(
        (row) =>
          (status === "all" || row.status === status) &&
          (matches(row, needle) || matchesCategories(row, needle)),
      ),
    [log, status, needle],
  );

  const filtered = status !== "all" || needle.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            {dict.admin.moderationFilters}
          </span>
          <button
            type="button"
            onClick={() => {
              setStatus("all");
              setQuery("");
            }}
            disabled={!filtered}
            className="ms-auto rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            {dict.admin.filterReset}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((value) => (
            <Chip
              key={value}
              active={status === value}
              onClick={() => setStatus(value)}
              count={counts[value]}
              tone={
                value === "blocked"
                  ? "danger"
                  : value === "flagged"
                    ? "warning"
                    : value === "allowed"
                      ? "good"
                      : undefined
              }
              label={
                value === "all"
                  ? dict.admin.filterAll
                  : value === "allowed"
                    ? dict.admin.filterAllowed
                    : value === "flagged"
                      ? dict.admin.filterFlagged
                      : dict.admin.filterBlocked
              }
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex min-w-0 flex-1 items-center sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute start-3 h-4 w-4 text-faint" />
            <span className="sr-only">{dict.admin.filterSearchPlaceholder}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={dict.admin.filterSearchPlaceholder}
              className="w-full rounded-xl border border-line bg-surface py-2.5 pe-3 ps-9 text-sm outline-none transition placeholder:text-faint focus:border-accent"
            />
          </label>
          <span className="text-xs text-faint">
            {interpolate(dict.admin.filterShowing, {
              shown: visibleLog.length,
              total: log.length,
            })}
          </span>
        </div>
      </div>

      <Section
        title={dict.admin.flaggedMessages}
        count={visibleFlagged.length}
        className="w-full"
      >
        {visibleFlagged.length === 0 ? (
          <EmptyNote>
            {filtered ? dict.admin.filterNothingMatches : dict.admin.nothingToReview}
          </EmptyNote>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleFlagged.map((message) => (
              <li
                key={message.id}
                className="flex flex-col gap-2 rounded-xl border border-line p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="warning">
                    {moderationStatusLabel(message.moderation_status, dict)}
                  </Badge>
                  <span className="ms-auto text-xs text-faint">
                    {relativeTime(message.created_at, dict, locale)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{message.content}</p>
                <MessageActions messageId={message.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={dict.admin.user.moderationHistory} count={visibleLog.length}>
        {visibleLog.length === 0 ? (
          <EmptyNote>
            {filtered ? dict.admin.filterNothingMatches : dict.admin.user.empty}
          </EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-line/50">
            {visibleLog.map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.status === "blocked" ? "danger" : "warning"}>
                    {moderationStatusLabel(row.status, dict)}
                  </Badge>
                  <Badge tone="neutral">{alertSeverityLabel(row.severity, dict)}</Badge>
                  {row.latency_ms !== null && (
                    <span className="text-xs text-faint">
                      {interpolate(dict.admin.user.latencyMs, { n: row.latency_ms })}
                    </span>
                  )}
                  <span className="ms-auto text-xs text-faint">
                    {relativeTime(row.created_at, dict, locale)}
                  </span>
                </div>
                {row.content_preview && (
                  <p className="text-sm text-muted">{row.content_preview}</p>
                )}
                {row.categories?.length ? (
                  <p className="text-xs text-faint">
                    {dict.admin.user.category}: {row.categories.join("، ")}
                  </p>
                ) : null}
                {(row.matched_terms?.length ?? 0) > 0 && (
                  <p className="text-xs text-faint">
                    {dict.admin.user.matchedTerms}: {row.matched_terms?.join("، ")}
                  </p>
                )}
                <div className="pt-1">
                  <LogRowActions logId={row.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
