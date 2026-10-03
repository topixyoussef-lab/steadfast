"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  signIn,
  signUp,
  updatePassword,
  type AuthFormState,
} from "@/app/actions/auth";
import { PhoneField } from "@/components/auth/phone-field";
import { useI18n } from "@/components/i18n-provider";
import { Field, FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type Mode = "login" | "signup" | "update-password";

type AuthFormProps = {
  mode: Mode;
  next?: string;
  notice?: string;
  phone?: string;
};

export function AuthForm({ mode, next, notice, phone }: AuthFormProps) {
  const { dict } = useI18n();
  const t = dict.auth;
  const action =
    mode === "login" ? signIn : mode === "signup" ? signUp : updatePassword;
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});

  const isLogin = mode === "login";
  const isSignup = mode === "signup";

  const heading = isLogin
    ? t.loginTitle
    : isSignup
      ? t.signupTitle
      : t.newPasswordTitle;
  const subheading = isLogin
    ? t.loginBody
    : isSignup
      ? t.signupBody
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

        <PhoneField
          defaultPhone={phone}
          errors={state.fieldErrors?.phone}
        />

        {isSignup ? (
          <p className="-mt-2 text-xs leading-relaxed text-faint">
            {t.phoneNoEmailNotice}
          </p>
        ) : null}

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

        <SubmitButton
          pendingLabel={isLogin ? t.pendingLogin : isSignup ? t.pendingSignup : t.updatingPassword}
        >
          {isLogin ? t.submitLogin : isSignup ? t.submitSignup : t.updatePassword}
        </SubmitButton>
      </form>

      {isLogin ? (
        <p className="-mt-2 text-center text-sm">
          <Link href="/forgot-password" className="text-muted hover:text-ink hover:underline">
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
          <Link href="/settings" className="font-semibold text-accent hover:underline">
            {t.backToLogin}
          </Link>
        )}
      </p>
    </div>
  );
}