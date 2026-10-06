import { PasskeySettings } from "@/components/auth/passkey-settings";
import { LanguageSwitcher } from "@/components/language-switcher";
import { requireProfile } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";
import { listCurrentPasskeys } from "@/app/actions/passkey";
import Link from "next/link";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.nav.settings };
}

export default async function SettingsPage() {
  await requireProfile();
  const dict = await getDictionary();

  const { passkeys, error } = await listCurrentPasskeys();

  return (
    <main className="flex w-full flex-col gap-8 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.nav.settings}</h1>
      </header>

      <div className="flex max-w-2xl flex-col gap-6">
        {error ? (
          <p className="rounded-2xl border border-dashed p-4 text-sm text-muted">
            {error}
          </p>
        ) : null}

        <section className="flex items-center justify-between gap-4 rounded-2xl border bg-surface p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{dict.settings.languageTitle}</h2>
            <p className="text-sm leading-relaxed text-muted">
              {dict.settings.languageBody}
            </p>
          </div>
          <LanguageSwitcher />
        </section>

        <PasskeySettings passkeys={passkeys} />

        <section className="flex items-center justify-between gap-4 rounded-2xl border bg-surface p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">
              {dict.settings.protectionCardTitle}
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              {dict.settings.protectionCardBody}
            </p>
          </div>
          <Link
            href="/protection"
            className="shrink-0 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink transition hover:border-line-strong"
          >
            {dict.protection.title}
          </Link>
        </section>

        <section className="flex flex-col items-start gap-4 rounded-2xl border bg-surface p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">
              {dict.landing.downloadTitle}
            </h2>
            <p className="text-sm leading-relaxed text-muted">
              {dict.landing.downloadBody}
            </p>
            <p className="text-xs text-faint">{dict.landing.downloadNote}</p>
          </div>
          <a
            href="/steadfast.apk"
            download
            className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-contrast hover:bg-accent-strong"
          >
            {dict.landing.downloadButton}
          </a>
        </section>
      </div>
    </main>
  );
}