"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  beginPasskeyEnrollment,
  finishPasskeyEnrollment,
  removePasskey,
} from "@/app/actions/passkey";
import { FingerprintIcon } from "@/components/icons";
import { useI18n } from "@/components/i18n-provider";
import type { PasskeyRow } from "@/lib/webauthn-server";
import { registerPasskey, webauthnAvailable } from "@/lib/passkey-client";

export function PasskeySettings({ passkeys }: { passkeys: PasskeyRow[] }) {
  const { dict } = useI18n();
  const t = dict.auth;
  const router = useRouter();

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const [enrolling, setEnrolling] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function enroll() {
    setError(null);
    setNotice(null);

    if (!webauthnAvailable()) {
      setError(t.passkeyUnsupported);
      return;
    }

    setEnrolling(true);
    try {
      const begin = (await beginPasskeyEnrollment()) as
        | { challengeId: string; options: unknown }
        | { error: string };

      if ("error" in begin) {
        setError(begin.error);
        return;
      }

      const attestation = await registerPasskey(begin.options);
      const result = (await finishPasskeyEnrollment(
        begin.challengeId,
        JSON.parse(attestation),
        null,
      )) as { ok?: boolean; error?: string };

      if (result.error) {
        setError(result.error);
        return;
      }

      setNotice(t.passkeyEnrolledNotice);
      router.refresh();
    } catch (caught) {
      setError(
        (caught as Error).message === "cancelled"
          ? t.passkeyCancelled
          : t.passkeyEnrollFailed,
      );
    } finally {
      setEnrolling(false);
    }
  }

  function remove(rowId: string) {
    setError(null);
    setNotice(null);
    setRemovingId(rowId);
    startTransition(async () => {
      const result = (await removePasskey(rowId)) as { ok: boolean };
      if (!result.ok) setError(t.passkeyEnrollFailed);
      else {
        setNotice(t.passkeyRemovedNotice);
        router.refresh();
      }
      setRemovingId(null);
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">
          {t.passkeySectionTitle}
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          {t.passkeySectionBody}
        </p>
      </header>

      {notice ? (
        <p role="status" className="text-sm text-accent">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {passkeys.length === 0 ? (
        <p className="text-sm text-muted">{t.passkeyNone}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {passkeys.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-line px-4 py-3"
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  {row.label ?? row.device_type ?? t.passkeySectionTitle}
                </span>
                <span className="text-xs text-faint">
                  {t.passkeyAddedOn}{" "}
                  {new Date(row.created_at).toLocaleDateString()} ·{" "}
                  {t.passkeyLastUsed}{" "}
                  {row.last_used_at
                    ? new Date(row.last_used_at).toLocaleDateString()
                    : t.passkeyNeverUsed}
                </span>
              </div>

              <button
                type="button"
                onClick={() => remove(row.id)}
                disabled={busy || removingId === row.id}
                className="shrink-0 text-sm font-medium text-danger hover:underline disabled:opacity-50"
              >
                {removingId === row.id ? t.passkeyRemoving : t.passkeyRemove}
              </button>
            </li>
          ))}
        </ul>
      )}

      {passkeys.length > 0 ? (
        <p className="text-xs text-faint">{t.passkeyDeleteWarning}</p>
      ) : null}

      <div>
        <button
          type="button"
          onClick={enroll}
          disabled={enrolling || busy}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-ink transition hover:opacity-90 disabled:opacity-50"
        >
          {t.passkeyEnroll}
          <FingerprintIcon className="h-4 w-4" />
          {enrolling ? <span className="text-xs opacity-70">{t.passkeyEnrolling}</span> : null}
        </button>
      </div>
    </section>
  );
}