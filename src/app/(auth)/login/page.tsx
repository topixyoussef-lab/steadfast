import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { PasskeySignIn } from "@/components/auth/passkey-signin";
import { FormError } from "@/components/ui/field";
import { getDictionary } from "@/lib/i18n/server";
import { passkeyTablesReady } from "@/lib/webauthn-server";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const [params, dict] = await Promise.all([searchParams, getDictionary()]);
  const next = typeof params.next === "string" ? params.next : undefined;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const registered = params.registered === "1";
  // Carried over from signup so the form arrives with the address already
  // filled in and the only thing left to do is the password.
  const email = typeof params.email === "string" ? params.email : undefined;

  const notices: Record<string, string> = {
    registered: dict.auth.noticeRegistered,
    oauth: dict.auth.noticeOauth,
    callback: dict.auth.noticeCallback,
  };

  const notice = registered
    ? notices.registered
    : errorKey
      ? (notices[errorKey] ?? null)
      : undefined;

  // Only lead with the fingerprint once the passkey tables actually exist.
  // Otherwise the page renders exactly as it did before this feature shipped,
  // so deploying can never make signing in harder for anyone.
  const passkeyReady = await passkeyTablesReady();

  if (!passkeyReady) {
    return (
      <AuthForm
        mode="login"
        next={next}
        email={email}
        notice={notice ?? undefined}
      />
    );
  }

  // Fingerprint-only. The password form is not offered as a link: it reveals
  // itself on its own the moment an address turns out to have no fingerprint yet,
  // which is the single bootstrap step needed to enrol the first one.
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.auth.loginTitle}</h1>
        <p className="text-sm leading-relaxed text-muted">
          {dict.auth.passkeySignInBody}
        </p>
      </header>

      {notice ? <FormError message={notice} /> : null}

      <PasskeySignIn next={next} defaultEmail={email} />
    </div>
  );
}