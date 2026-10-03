import Link from "next/link";

import { LanguageSwitcher } from "@/components/language-switcher";
import { BrandMark } from "@/components/ui/brand-mark";
import { getDictionary } from "@/lib/i18n/server";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const dict = await getDictionary();

  return (
    <main className="flex min-h-dvh flex-col safe-t">
      <header className="flex items-center justify-between gap-3 px-5 pt-4">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">
            {dict.common.appName}
          </span>
        </Link>
        <LanguageSwitcher />
      </header>

      <div className="flex flex-1 items-start justify-center px-5 py-8">
        <div className="w-full max-w-sm">{children}</div>
      </div>

      <footer className="safe-b px-5 pb-4 text-center text-xs leading-relaxed text-faint">
        <p>{dict.crisis.immediateDanger}</p>
        <p className="mt-1">{dict.crisis.linesAvailable}</p>
      </footer>
    </main>
  );
}
