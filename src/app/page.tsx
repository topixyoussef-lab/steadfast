import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandMark } from "@/components/ui/brand-mark";
import { getProfile, getUser } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";
import { PREFERENCES } from "@/lib/preferences";

export const metadata: Metadata = {
  title: "Steadfast — replace the habit, keep the streak",
};

export default async function LandingPage() {
  const [user, dict] = await Promise.all([getUser(), getDictionary()]);
  if (user) {
    const profile = await getProfile();
    redirect(profile?.onboarding_done ? "/dashboard" : "/onboarding");
  }

  const t = dict.landing;

  return (
    <main className="flex min-h-dvh flex-col safe-t">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">
            {dict.common.appName}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <Link
            href="/login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-surface"
          >
            {dict.nav.signIn}
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-contrast hover:bg-accent-strong"
          >
            {dict.nav.start}
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-16 px-5 py-10">
        <section className="flex flex-col gap-6">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            {t.heroLine1}
            <br />
            {t.heroLine2}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted">
            {t.heroBody}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center rounded-xl bg-accent px-6 text-base font-semibold text-accent-contrast hover:bg-accent-strong"
            >
              {t.createAccount}
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 items-center rounded-xl border border-line bg-surface px-6 text-base font-medium hover:border-line-strong"
            >
              {t.haveAccount}
            </Link>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          {PREFERENCES.map((pref) => (
            <article
              key={pref.id}
              className="flex flex-col gap-2 rounded-2xl border bg-surface p-5 shadow-sm"
            >
              <h2 className="text-base font-semibold">{pref.label(dict)}</h2>
              <p className="text-sm text-muted">{pref.tagline(dict)}</p>
              <p className="text-sm leading-relaxed text-ink/90">
                {pref.description(dict)}
              </p>
            </article>
          ))}
          <article className="flex flex-col gap-2 rounded-2xl border border-dashed bg-surface/50 p-5">
            <h2 className="text-base font-semibold text-muted">
              {t.comingNext}
            </h2>
            <p className="text-sm text-muted">{t.comingNextBody}</p>
          </article>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {[
            [t.featureTasksTitle, t.featureTasksBody],
            [t.featureStreaksTitle, t.featureStreaksBody],
            [t.featureSafetyTitle, t.featureSafetyBody],
          ].map(([title, body]) => (
            <div key={title} className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </section>
      </div>

      <footer className="safe-b mx-auto w-full max-w-3xl px-5 pb-6 text-xs leading-relaxed text-faint">
        {t.footer}
      </footer>
    </main>
  );
}
