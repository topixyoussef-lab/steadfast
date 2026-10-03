"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signIn, signInWithGoogle, signUp, requestPasswordReset, updatePassword, type AuthFormState } from "@/app/actions/auth";
import { useI18n } from "@/components/i18n-provider";
import { Field, FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type Mode = "login" | "signup" | "forgot" | "update-password";

type AuthFormProps = {
  mode: Mode;
  next?: string;
  notice?: string;
  email?: string;
};

// Supabase rejects an OAuth call for a provider the project never enabled, so
// the button is hidden unless Google is actually configured. Enabling it needs
// a Google Cloud OAuth client in Supabase Auth > Providers.
const googleEnabled = process.env.NEXT_PUBLIC_SUPABASE_GOOGLE_AUTH === "true";

export function AuthForm({ mode, next, notice, email }: AuthFormProps) {
  const { dict } = useI18n();
  const t = dict.auth;
  const action =
    mode === "login"
      ? signIn
      : mode === "signup"
        ? signUp
        : mode === "forgot"
          ? requestPasswordReset
          : updatePassword;
  const [state, formAction] = useActionState<AuthFormState, FormData>(
    action,
    {},
  );

  const isLogin = mode === "login";
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";

  const heading = isLogin
    ? t.loginTitle
    : isSignup
      ? t.signupTitle
      : isForgot
        ? t.resetTitle
        : t.newPasswordTitle;
  const subheading = isLogin
    ? t.loginBody
    : isSignup
      ? t.signupBody
      : isForgot
        ? t.resetBody
        : t.newPasswordBody;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="text-sm leading-relaxed text-muted">{subheading}</p>
      </header>

      {notice ? <FormError message={notice} /> : null}
      {state.notice ? <FormError message={state.notice} /> : null}
      <FormError message={state.error} />

      {googleEnabled && (isLogin || isSignup) ? (
        <>
          <GoogleButton next={next} pendingLabel={t.openingGoogle}>
            {t.continueWithGoogle}
          </GoogleButton>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs uppercase tracking-wider text-faint">
              {t.orEmail}
            </span>
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}

      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        {isSignup ? (
          <Field
            label={t.nameLabel}
            name="displayName"
            placeholder={t.namePlaceholder}
            autoComplete="nickname"
            required
            minLength={2}
            errors={state.fieldErrors?.displayName}
          />
        ) : null}

        {!isSignup && !isForgot ? null : (
          <Field
            label={t.emailLabel}
            name="email"
            type="email"
            placeholder={t.emailPlaceholder}
            autoComplete="email"
            defaultValue={email}
            required
            errors={state.fieldErrors?.email}
          />
        )}

        {isForgot ? null : (
          <Field
            label={isLogin ? t.passwordLabel : t.newPasswordTitle}
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete={isLogin ? "current-password" : "new-password"}
            required
            minLength={8}
            errors={state.fieldErrors?.password}
            hint={isSignup ? t.passwordHint : undefined}
          />
        )}

        <SubmitButton
          pendingLabel={
            isLogin
              ? t.pendingLogin
              : isSignup
                ? t.pendingSignup
                : isForgot
                  ? t.resetSending
                  : t.updatingPassword
          }
        >
          {isLogin
            ? t.submitLogin
            : isSignup
              ? t.submitSignup
              : isForgot
                ? t.resetSend
                : t.updatePassword}
        </SubmitButton>
      </form>

      {isLogin ? (
        <p className="-mt-2 text-center text-sm">
          <Link
            href="/forgot-password"
            className="text-muted hover:text-ink hover:underline"
          >
            {t.forgotPassword}
          </Link>
        </p>
      ) : null}

      <p className="text-center text-sm text-muted">
        {isLogin ? (
          <>
            {t.noAccountYet}{" "}
            <Link
              href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
              className="font-semibold text-accent hover:underline"
            >
              {t.createOne}
            </Link>
          </>
        ) : isSignup ? (
          <>
            {t.haveAccountQuestion}{" "}
            <Link
              href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
              className="font-semibold text-accent hover:underline"
            >
              {t.submitLogin}
            </Link>
          </>
        ) : (
          <Link
            href="/login"
            className="font-semibold text-accent hover:underline"
          >
            {t.backToLogin}
          </Link>
        )}
      </p>
    </div>
  );
}

function GoogleButton({
  next,
  pendingLabel,
  children,
}: {
  next?: string;
  pendingLabel: string;
  children: React.ReactNode;
}) {
  return (
    <form action={signInWithGoogle}>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <SubmitButton variant="ghost" pendingLabel={pendingLabel}>
        <GoogleIcon />
        {children}
      </SubmitButton>
    </form>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.55-5.17 3.55-8.87z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}
