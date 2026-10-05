"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useActionState, useSyncExternalStore } from "react";

import { signIn, type AuthFormState } from "@/app/actions/auth";
import {
  beginPasskeySignIn,
  completePasskeySignIn,
} from "@/app/actions/passkey";
import { PhoneField } from "@/components/auth/phone-field";
import { useI18n } from "@/components/i18n-provider";
import { Field, FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FingerprintIcon } from "@/components/icons";
import { assertPasskey, webauthnAvailable } from "@/lib/passkey-client";

function noopSubscribe() {
  return () => {};
}

/**
 * Sign-in: phone number and password, with the fingerprint kept as a second
 * button on the same screen.
 *
 * Both live in one form so the number is typed once. The fingerprint button
 * overrides the form's action with its own and skips validation, because the
 * password field it does not use is a required input.
 *
 * The fingerprint is a two-step exchange: the first action returns a WebAuthn
 * challenge bound to the resolved user id, this component reads the fingerprint
 * against it, and the second action turns the assertion into a session.
 */
export function SignInForm({
  next,
  defaultPhone,
}: {
  next?: string;
  defaultPhone?: string;
}) {
  const { dict } = useI18n();
  const t = dict.auth;

  const [passwordState, passwordAction, passwordPending] =
    useActionState<AuthFormState, FormData>(signIn, {});
  const [state, passkeyAction, passkeyPending] = useActionState(
    beginPasskeySignIn,
    {},
  );

  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const awaited = useRef<string | null>(null);

  // A client-side capability, not application state: useSyncExternalStore reads it
  // without a render-cascading effect.
  //
  // The server snapshot is deliberately optimistic (true) so the fingerprint
  // button is what the server sends. A device that genuinely lacks WebAuthn
  // still hides it, because getSnapshot() reports false there.
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => webauthnAvailable(),
    () => true,
  );

  const challengeId = state.passkeyChallengeId;

  useEffect(() => {
    if (!state.passkeyRequired || !challengeId) return;
    if (awaited.current === challengeId) return;

    let cancelled = false;
    awaited.current = challengeId;
    setScanning(true);
    setPasskeyError(null);

    (async () => {
      if (!webauthnAvailable()) {
        setPasskeyError(t.passkeyUnsupported);
        setScanning(false);
        return;
      }

      try {
        const result = await assertPasskey(state.passkeyOptions);
        if (cancelled) return;

        setScanning(false);

        // Hand the assertion straight to the server; it mints the session.
        requestAnimationFrame(() => {
          void completePasskeySignIn(challengeId, result, next);
        });
      } catch (error) {
        if (cancelled) return;
        setPasskeyError(
          (error as Error).message === "cancelled"
            ? t.passkeyCancelled
            : t.passkeyFailed,
        );
        setScanning(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.passkeyRequired, state.passkeyOptions, challengeId, next, t]);

  const busy = passkeyPending || scanning;
  const error = passwordState.error ?? state.error ?? null;

  return (
    <div className="flex flex-col gap-6">
      <form action={passwordAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <PhoneField
          defaultPhone={defaultPhone}
          errors={passwordState.fieldErrors?.phone}
        />

        <Field
          label={t.passwordLabel}
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          required
          minLength={8}
          errors={passwordState.fieldErrors?.password}
        />

        <SubmitButton pendingLabel={t.pendingLogin}>
          {t.submitLogin}
        </SubmitButton>

        {supported ? (
          <>
            <p className="flex items-center gap-3 text-xs text-faint">
              <span className="h-px flex-1 bg-line" aria-hidden />
              {t.orLabel}
              <span className="h-px flex-1 bg-line" aria-hidden />
            </p>

            <SubmitButton
              variant="ghost"
              formAction={passkeyAction}
              formNoValidate
              pendingLabel={t.passkeyReading}
            >
              <FingerprintIcon className="h-5 w-5" />
              {t.passkeySignIn}
            </SubmitButton>
          </>
        ) : null}
      </form>

      {state.passkeyRequired ? (
        <p
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 text-center text-sm text-muted"
        >
          <FingerprintIcon className="h-4 w-4 shrink-0" />
          {passkeyError ??
            (busy || passwordPending ? t.passkeyVerifying : t.passkeyPrompt)}
        </p>
      ) : null}

      {passkeyError ? <FormError message={passkeyError} /> : null}
      {error ? <FormError message={error} /> : null}

      <p className="-mt-2 text-center text-sm">
        <Link
          href="/forgot-password"
          className="text-muted hover:text-ink hover:underline"
        >
          {t.forgotPassword}
        </Link>
      </p>

      <p className="-mt-4 text-center text-sm text-muted">
        {t.noAccountYet}{" "}
        <Link
          href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          className="font-semibold text-accent hover:underline"
        >
          {t.createOne}
        </Link>
      </p>
    </div>
  );
}
