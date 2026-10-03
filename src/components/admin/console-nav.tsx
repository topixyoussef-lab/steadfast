"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  BriefcaseIcon,
  ChatIcon,
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
  { href: "/admin/jobs", icon: BriefcaseIcon, labelKey: "jobs" },
];

/** Section switcher for the console. Deliberately not the member sidebar. */
export function ConsoleNav({ dict }: { dict: Dictionary }) {
  const pathname = usePathname() ?? "";

  return (
    <ul className="flex gap-1 lg:flex-col">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);

        return (
          <li key={item.href} className="shrink-0 lg:shrink">
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition",
                "text-muted hover:bg-surface hover:text-ink",
                active &&
                  "bg-accent text-accent-contrast hover:bg-accent hover:text-accent-contrast",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="whitespace-nowrap">{dict.console[item.labelKey]}</span>
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