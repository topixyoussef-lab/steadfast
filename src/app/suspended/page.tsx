import Link from "next/link";

import { getDictionary } from "@/lib/i18n/server";

export default async function SuspendedPage() {
  const dict = await getDictionary();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5 safe-t safe-b">
      <h1 className="text-2xl font-semibold tracking-tight">
        {dict.suspended.title}
      </h1>
      <p className="text-base leading-relaxed text-muted">
        {dict.suspended.body}
      </p>
      <Link
        href="/dashboard"
        className="inline-flex h-12 items-center justify-center rounded-xl border border-line bg-surface font-medium hover:border-line-strong"
      >
        {dict.suspended.backToDashboard}
      </Link>
    </main>
  );
}
