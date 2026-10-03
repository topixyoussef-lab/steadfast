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

  const passwordForm = (
    <AuthForm
      mode="login"
      next={next}
      email={email}
      notice={notice ?? undefined}
    />
  );

  if (!passkeyReady) return passwordForm;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {dict.auth.loginTitle}
          </h1>
          <p className="text-sm leading-relaxed text-muted">
            {dict.auth.passkeySignInBody}
          </p>
        </header>

        {notice ? <FormError message={notice} /> : null}

        <PasskeySignIn next={next} defaultEmail={email} />
      </div>

      <details>
        <summary className="cursor-pointer text-center text-sm text-muted hover:text-ink">
          {dict.auth.passkeyPasswordFallback}
        </summary>
        <div className="pt-6">{passwordForm}</div>
      </details>
    </div>
  );
}