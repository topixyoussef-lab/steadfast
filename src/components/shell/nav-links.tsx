"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BellIcon, BriefcaseIcon, ChatIcon, GearIcon, HomeIcon, ShieldIcon, UsersIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type NavItem = {
  href: string;
  label: string;
  icon: typeof HomeIcon;
  badge?: number;
};

/** The member chat lives at this room; it gets its own slot, not a list click. */
const CHAT_HREF = "/community/main-hall";

/**
 * The link list of the member shell.
 *
 * Client-side only because it reads the current pathname to mark the active
 * item. Notifications sit on top because that is where urgency lives; the rest
 * follow in reading order. Horizontal strip on small screens, column from `lg`
 * up, logical properties only so it flips sides in Arabic by itself.
 */
export function NavLinks({
  dict,
  unread,
  isStaff,
}: {
  dict: Dictionary;
  unread: number;
  isStaff: boolean;
}) {
  const pathname = usePathname() ?? "";

  const items: NavItem[] = [
    { href: "/notifications", label: dict.nav.notifications, icon: BellIcon, badge: unread },
    { href: "/dashboard", label: dict.nav.dashboard, icon: HomeIcon },
    { href: CHAT_HREF, label: dict.nav.chat, icon: ChatIcon },
    { href: "/community", label: dict.nav.communityRooms, icon: UsersIcon },
    { href: "/jobs", label: dict.nav.microJobs, icon: BriefcaseIcon },
    { href: "/settings", label: dict.nav.settings, icon: GearIcon },
  ];

  if (isStaff) {
    items.push({ href: "/admin", label: dict.nav.adminConsole, icon: ShieldIcon });
  }

  return (
    <ul className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:px-3 lg:pb-0">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);

        return (
          <li key={item.href} className="shrink-0 lg:shrink">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={
                item.badge ? interpolate(dict.nav.unreadCount, { n: item.badge }) : undefined
              }
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                "text-muted hover:bg-sunken hover:text-ink",
                active && "bg-accent-soft text-accent",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="whitespace-nowrap">{item.label}</span>
              {item.badge ? (
                <span className="ms-auto hidden h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger-soft px-1.5 text-[11px] font-semibold text-danger lg:flex">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Exact match for single-screen routes, prefix match so `/jobs/42` lights `/jobs`. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard" || href === "/notifications") return pathname === href;

  // The chat room is reached straight from the strip, so it must not light the
  // rooms list as well, and vice versa.
  if (href === "/community") return pathname === "/community" || isOtherRoom(pathname);

  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The rooms list lights for any room except the chat, which has its own slot. */
function isOtherRoom(pathname: string): boolean {
  return (
    pathname.startsWith("/community/") &&
    pathname !== CHAT_HREF &&
    !pathname.startsWith(`${CHAT_HREF}/`)
  );
}