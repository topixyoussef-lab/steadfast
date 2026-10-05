"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  beginPasskeySignIn,
  completePasskeySignIn,
} from "@/app/actions/passkey";
import { AuthForm } from "@/components/auth/auth-form";
import { PhoneField } from "@/components/auth/phone-field";
import { useI18n } from "@/components/i18n-provider";
import { FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FingerprintIcon } from "@/components/icons";
import { assertPasskey, webauthnAvailable } from "@/lib/passkey-client";

function noopSubscribe() {
  return () => {};
}

/**
 * Passwordless sign-in.
 *
 * Step 1 posts the phone number and gets back a WebAuthn challenge bound to that user.
 * Step 2 reads the fingerprint and posts the assertion, which the server turns
 * into a Supabase session. No password is involved at any point.
 */
export function PasskeySignIn({
  next,
  defaultPhone,
}: {
  next?: string;
  defaultPhone?: string;
}) {
  const { dict } = useI18n();
  const t = dict.auth;

  const [state, formAction, pending] = useActionState(beginPasskeySignIn, {});
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const awaited = useRef<string | null>(null);

  // A client-side capability, not application state: useSyncExternalStore reads it
  // without a render-cascading effect.
  //
  // The server snapshot is deliberately optimistic (true) so the fingerprint UI
  // is what the server sends. Rendering the password form on the server and
  // swapping it for the fingerprint after hydration meant the page looked
  // unchanged until JavaScript ran, and looked broken when it did not.
  // A device that genuinely lacks WebAuthn still falls back to the password
  // form, because getSnapshot() reports false there.
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

  const busy = pending || scanning;

  if (!supported) {
    return (
      <div className="flex flex-col gap-6">
        <p className="rounded-2xl border border-dashed p-4 text-center text-sm text-muted">
          {t.passkeyUnsupported}
        </p>
        <AuthForm mode="login" next={next} phone={defaultPhone} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <PhoneField defaultPhone={defaultPhone} />

        <SubmitButton pendingLabel={t.passkeyReading}>
          <FingerprintIcon className="h-5 w-5" />
          {t.passkeySignIn}
        </SubmitButton>
      </form>

      {state.passkeyRequired ? (
        <p
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-2 text-center text-sm text-muted"
        >
          <FingerprintIcon className="h-4 w-4 shrink-0" />
          {passkeyError ?? (busy ? t.passkeyVerifying : t.passkeyPrompt)}
        </p>
      ) : null}

      {passkeyError ? <FormError message={passkeyError} /> : null}
      {state.error && !state.passkeyMissing ? (
        <FormError message={state.error} />
      ) : null}

      {/* A fingerprint that fails or is dismissed must not be a dead end: this
          device may hold no enrolled credential, and the password form is the
          only other way in. Nothing to enrol with yet, so it also appears once
          on the very first visit. */}
      {state.passkeyMissing || usePassword ? (
        <>
          {state.passkeyMissing ? <FormError message={state.error} /> : null}
          <AuthForm mode="login" next={next} phone={defaultPhone} />
        </>
      ) : passkeyError ? (
        <button
          type="button"
          onClick={() => setUsePassword(true)}
          className="self-center text-sm text-primary underline underline-offset-4"
        >
          {t.usePasswordInstead}
        </button>
      ) : null}
    </div>
  );
}