import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { ConsoleNav } from "@/components/admin/console-nav";
import { BackIcon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/language-switcher";
import { requireStaff } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";
import { authEmailToPhone, formatPhone } from "@/lib/phone";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return {
    title: {
      default: dict.console.title,
      template: `%s · ${dict.console.title}`,
    },
    robots: { index: false, follow: false },
  };
}

/**
 * Chrome for the staff console.
 *
 * This is a separate surface from the member app on purpose: it does not reuse
 * the member sidebar, it has its own identity and its own section switcher, and
 * the only way back into the product is the explicit "back to app" link. Staff
 * guard runs here so every console route inherits it.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const [staff, dict] = await Promise.all([requireStaff(), getDictionary()]);

  return (
    <div className="flex min-h-dvh w-full flex-col bg-sunken lg:flex-row">
      <aside className="safe-t z-20 shrink-0 border-b border-line bg-sunken lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:flex-col lg:border-b-0 lg:border-e">
        <div className="flex items-center gap-2 px-4 py-4 lg:px-5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-contrast">
            S
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              {dict.console.title}
            </p>
            <p dir="ltr" className="truncate text-[11px] text-faint">
              {formatPhone(authEmailToPhone(staff.email)) || staff.email}
            </p>
          </div>
        </div>

        <div className="px-3 pb-3 lg:px-4">
          <ConsoleNav dict={dict} />
        </div>

        <div className="hidden flex-col gap-3 border-t border-line px-4 py-4 lg:mt-auto lg:flex">
          <LanguageSwitcher />
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface hover:text-ink"
          >
            <BackIcon className="h-4 w-4 shrink-0 rtl:rotate-180" />
            {dict.console.backToApp}
          </Link>
        </div>
      </aside>

      {/* On narrow screens the console chrome collapses; keep the escape hatch. */}
      <div className="min-w-0 flex-1 safe-b">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 lg:hidden">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-muted hover:text-ink"
          >
            <BackIcon className="h-4 w-4 rtl:rotate-180" />
            {dict.console.backToApp}
          </Link>
          <LanguageSwitcher />
        </div>

        {children}
      </div>
    </div>
  );
}