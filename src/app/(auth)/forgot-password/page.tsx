import type { Metadata } from "next";
import Link from "next/link";

import { getDictionary } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Password recovery" };

// There is no reset form here, and that is deliberate. Steadfast stores no email
// address, so there is no inbox to send a link to, and no SMS provider is
// configured for a code. A member who loses both their fingerprint and their
// password has an admin set a new one from the member dossier.
export default async function ForgotPasswordPage() {
  const dict = await getDictionary();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.auth.noSelfRecoveryTitle}
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          {dict.auth.noSelfRecoveryBody}
        </p>
      </header>

      <p className="text-center text-sm">
        <Link href="/login" className="font-semibold text-accent hover:underline">
          {dict.auth.backToLogin}
        </Link>
      </p>
    </div>
  );
}