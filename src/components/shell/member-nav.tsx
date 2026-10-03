import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NavLinks } from "@/components/shell/nav-links";
import type { Dictionary } from "@/lib/i18n/dictionaries";

/**
 * Sidebar frame for the member area. Sticky and full height from `lg` up,
 * collapses to a horizontal strip above it.
 */
export function MemberNav({
  dict,
  unread,
  isStaff,
}: {
  dict: Dictionary;
  unread: number;
  isStaff: boolean;
}) {
  return (
    <nav
      aria-label={dict.nav.primaryLabel}
      className="safe-t z-20 shrink-0 border-b border-line bg-surface lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:border-b-0 lg:border-e"
    >
      <Link
        href="/dashboard"
        className="flex items-center gap-2 px-4 py-4 text-base font-semibold tracking-tight lg:pb-2"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-sm text-accent">
          S
        </span>
        <span className="truncate">{dict.common.appName}</span>
      </Link>

      <NavLinks dict={dict} unread={unread} isStaff={isStaff} />

      <div className="hidden flex-col gap-2 border-t border-line px-3 py-3 lg:flex">
        <LanguageSwitcher />
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition hover:bg-sunken hover:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-5 w-5 shrink-0"
            >
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
              <path d="M10 8 6 12l4 4" />
              <path d="M6 12h9" />
            </svg>
            {dict.common.signOut}
          </button>
        </form>
      </div>
    </nav>
  );
}