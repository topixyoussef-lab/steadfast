"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { ChevronIcon, SearchIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { roleLabel } from "@/lib/format";
import { interpolate } from "@/lib/i18n/interpolate";
import { authEmailToPhone, formatPhone } from "@/lib/phone";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export type MemberRow = {
  id: string;
  display_name: string | null;
  /** Absent once get_admin_members returns phone instead of email. */
  email?: string | null;
  /** Absent until migration 0003 adds profiles.phone. */
  phone?: string | null;
  role: string;
  current_streak: number;
  last_active_day: string | null;
  is_suspended: boolean;
};

/**
 * A member's identity is their phone number, but the directory receives either
 * the real column or the synthetic auth address depending on which migrations
 * have been applied, so accept both. Staff accounts with a genuine email keep
 * showing it, since there is no phone to derive.
 */
function memberIdentity(member: MemberRow): string | null {
  const phone = formatPhone(member.phone ?? authEmailToPhone(member.email));
  return phone || member.email || null;
}

/**
 * Member directory for the console. Filtering happens in the browser because
 * the whole point is to find one person fast, and the row set is already
 * capped server side.
 */
export function MemberDirectory({
  members,
  dict,
}: {
  members: MemberRow[];
  dict: Dictionary;
}) {
  const [query, setQuery] = useState("");
  const u = dict.admin.user;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;

    return members.filter((member) =>
      [member.display_name, memberIdentity(member), member.email, member.id]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [members, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex min-w-0 flex-1 items-center sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute start-3 h-4 w-4 text-faint" />
          <span className="sr-only">{u.searchPlaceholder}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={u.searchPlaceholder}
            className="w-full rounded-xl border border-line bg-surface py-2.5 pe-3 ps-9 text-sm outline-none transition placeholder:text-faint focus:border-accent"
          />
        </label>
        <span className="text-xs text-faint">
          {interpolate(u.memberCount, { n: filtered.length })}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted">
          {u.noMembers}
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((member) => (
            <li key={member.id}>
              <Link
                href={`/admin/users/${member.id}`}
                className={cn(
                  "flex h-full flex-col gap-1.5 rounded-2xl border border-line bg-surface p-4 transition",
                  "hover:border-accent/60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {member.display_name ?? dict.admin.unnamed}
                    </span>
                    <span className="block truncate text-xs text-faint">
                      {memberIdentity(member)}
                    </span>
                  </span>
                  <ChevronIcon className="mt-1 h-4 w-4 shrink-0 text-faint" />
                </div>

                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                  {member.role !== "user" && <Badge>{roleLabel(member.role, dict)}</Badge>}
                  {member.is_suspended && (
                    <Badge tone="danger">{dict.admin.suspendedBadge}</Badge>
                  )}
                  <span className="text-[11px] text-faint">
                    {interpolate(dict.admin.streakDaysShort, { n: member.current_streak })}
                  </span>
                  {member.last_active_day && (
                    <span className="ms-auto text-[11px] text-faint">
                      {dict.admin.user.lastActive}: {member.last_active_day}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        tone === "neutral" ? "bg-sunken text-muted" : "bg-danger-soft text-danger",
      )}
    >
      {children}
    </span>
  );
}