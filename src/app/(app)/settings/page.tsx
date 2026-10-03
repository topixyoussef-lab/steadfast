import { PasskeySettings } from "@/components/auth/passkey-settings";
import { requireProfile } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";
import { listCurrentPasskeys } from "@/app/actions/passkey";

export const metadata = { title: "Settings — Steadfast" };

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
        <PasskeySettings passkeys={passkeys} />
      </div>
    </main>
  );
}