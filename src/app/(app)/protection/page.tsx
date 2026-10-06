import Link from "next/link";

import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.protection.title };
}

function GuideCard({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-surface p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
        {body}
      </p>
      {children}
    </section>
  );
}

export default async function ProtectionPage() {
  const dict = await getDictionary();

  const providers = [
    { name: dict.protection.dnsBrowse, host: "custom.filter.dns.cleanbrowsing.org" },
    { name: dict.protection.dnsFamily, host: "family.cloudflare-dns.com" },
    { name: dict.protection.dnsAdguard, host: "dns.adguard.com" },
  ];

  return (
    <main className="flex w-full flex-col gap-8 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.protection.title}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted">
          {dict.protection.intro}
        </p>
        <Link
          href="/settings"
          className="mt-1 text-sm font-medium text-accent underline underline-offset-2"
        >
          {dict.protection.backToSettings}
        </Link>
      </header>

      <div className="flex max-w-2xl flex-col gap-4">
        <GuideCard title={dict.protection.androidTitle} body={dict.protection.androidBody} />
        <GuideCard title={dict.protection.iosTitle} body={dict.protection.iosBody} />
        <GuideCard title={dict.protection.routerTitle} body={dict.protection.routerBody} />

        <GuideCard title={dict.protection.providersTitle} body={dict.protection.providersBody}>
          <ul className="flex flex-col gap-2">
            {providers.map((provider) => (
              <li
                key={provider.host}
                className="flex flex-col gap-0.5 rounded-xl bg-sunken px-3 py-2.5"
              >
                <span className="text-xs font-medium text-ink">{provider.name}</span>
                <code dir="ltr" className="text-xs font-mono text-accent">
                  {provider.host}
                </code>
              </li>
            ))}
          </ul>
        </GuideCard>

        <p className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm leading-relaxed text-accent">
          {dict.protection.love}
        </p>
      </div>
    </main>
  );
}