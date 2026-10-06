"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  BellIcon,
  BriefcaseIcon,
  ChatIcon,
  DoorIcon,
  ShieldIcon,
  UsersIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type ConsoleItem = {
  href: string;
  icon: typeof ShieldIcon;
  /** Key into `dict.console`, narrowed so a typo is a compile error. */
  labelKey: keyof Dictionary["console"];
};

const ITEMS: ConsoleItem[] = [
  { href: "/admin", icon: ShieldIcon, labelKey: "overview" },
  { href: "/admin/members", icon: UsersIcon, labelKey: "members" },
  { href: "/admin/moderation", icon: ChatIcon, labelKey: "moderation" },
  { href: "/admin/rooms", icon: DoorIcon, labelKey: "rooms" },
  { href: "/admin/jobs", icon: BriefcaseIcon, labelKey: "jobs" },
  { href: "/admin/messages", icon: BellIcon, labelKey: "messages" },
];

/** Section switcher for the console. Deliberately not the member sidebar. */
export function ConsoleNav({ dict }: { dict: Dictionary }) {
  const pathname = usePathname() ?? "";

  return (
    <ul className="grid auto-cols-fr grid-flow-col gap-1 lg:flex lg:flex-col">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);

        return (
          <li key={item.href} className="min-w-0">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                // Equal columns below `lg`: the five labels together need more
                // than a phone gives, and this list has no scroll container, so
                // a row of shrink-0 items used to push past the page edge.
                "flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center text-[10px] leading-tight transition",
                "text-muted hover:bg-surface hover:text-ink",
                active &&
                  "bg-accent text-accent-contrast hover:bg-accent hover:text-accent-contrast",
                "lg:flex-row lg:gap-2.5 lg:px-3 lg:py-2 lg:text-start lg:text-sm",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="max-w-full break-words lg:whitespace-nowrap">
                {dict.console[item.labelKey]}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** `/admin` is exact so the index does not stay lit while inside a subsection. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}