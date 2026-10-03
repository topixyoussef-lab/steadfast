"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  beginPasskeySignIn,
  completePasskeySignIn,
} from "@/app/actions/passkey";
import { useI18n } from "@/components/i18n-provider";
import { Field, FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FingerprintIcon } from "@/components/icons";
import { assertPasskey, webauthnAvailable } from "@/lib/passkey-client";

function noopSubscribe() {
  return () => {};
}

/**
 * Passwordless sign-in.
 *
 * Step 1 posts the email and gets back a WebAuthn challenge bound to that user.
 * Step 2 reads the fingerprint and posts the assertion, which the server turns
 * into a Supabase session. No password is involved at any point.
 */
export function PasskeySignIn({
  next,
  defaultEmail,
}: {
  next?: string;
  defaultEmail?: string;
}) {
  const { dict } = useI18n();
  const t = dict.auth;

  const [state, formAction, pending] = useActionState(beginPasskeySignIn, {});
  const [assertion, setAssertion] = useState<string | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const awaited = useRef<string | null>(null);

  // A client-side capability, not application state: useSyncExternalStore reads it
  // without a render-cascading effect and keeps the server snapshot false so the
  // first client render matches the markup React sent.
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => webauthnAvailable(),
    () => false,
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

        setAssertion(result);
        setScanning(false);

        // Let React commit the state, then hand the assertion to the server.
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
      <p className="rounded-2xl border border-dashed p-4 text-center text-sm text-muted">
        {t.passkeyUnsupported}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <Field
          label={t.emailLabel}
          name="email"
          type="email"
          placeholder={t.emailPlaceholder}
          autoComplete="email"
          defaultValue={defaultEmail}
          required
        />

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
      {state.error ? <FormError message={state.error} /> : null}

      {assertion ? (
        <input type="hidden" name="passkeyAssertion" value={assertion} readOnly />
      ) : null}
    </div>
  );
}