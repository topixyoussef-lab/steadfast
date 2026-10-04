import type { Metadata } from "next";

import { PasskeySignIn } from "@/components/auth/passkey-signin";
import { FormError } from "@/components/ui/field";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.auth.loginTitle };
}

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const [params, dict] = await Promise.all([searchParams, getDictionary()]);
  const next = typeof params.next === "string" ? params.next : undefined;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  // Carried over from signup so the form arrives with the number already
  // filled in and the only thing left to do is the password.
  const phone = typeof params.phone === "string" ? params.phone : undefined;

  const notice = errorKey ? (dict.auth.noticeCallback ?? null) : null;

  // Fingerprint-only, unconditionally. No migration gate: if the passkey tables
  // are not there yet, beginPasskeySignIn reports "no fingerprint enrolled" and the
  // password form reveals itself, which is a clearer answer than hiding the whole
  // feature behind a table the user has to go and create by hand.
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.auth.loginTitle}</h1>
        <p className="text-sm leading-relaxed text-muted">
          {dict.auth.passkeySignInBody}
        </p>
      </header>

      {notice ? <FormError message={notice} /> : null}

      <PasskeySignIn next={next} defaultPhone={phone} />
    </div>
  );
}