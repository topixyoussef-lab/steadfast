"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { setLocaleAction } from "@/app/actions/locale";
import { useI18n } from "@/components/i18n-provider";
import { localeLabel, locales, type Locale } from "@/lib/i18n/config";

export function LanguageSwitcher() {
  const { locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(next: Locale) {
    if (next === locale) return;
    startTransition(async () => {
      await setLocaleAction(next);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={localeLabel[locale]}
      className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5"
    >
      {locales.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => pick(code)}
          disabled={pending}
          aria-current={code === locale}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
            code === locale
              ? "bg-accent text-accent-contrast"
              : "text-muted hover:text-ink"
          }`}
        >
          {localeLabel[code]}
        </button>
      ))}
    </div>
  );
}