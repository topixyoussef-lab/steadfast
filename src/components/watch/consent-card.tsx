"use client";

import { useState, useTransition } from "react";

import {
  enableMonitoringWatchAction,
  revokeMonitoringWatchAction,
} from "@/app/actions/watch";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";

export type ConsentState = {
  status: "active" | "revoked" | null;
  consented_at: string | null;
};

/**
 * The agreed-protection switch, shown in Settings. Consent belongs to the
 * member and only the member: no text here is ever phrased as something staff
 * turned on. The row lives behind SECURITY DEFINER functions (0011) so this
 * client component cannot fake a consent either way.
 */
export function ConsentCard({ consent }: { consent: ConsentState }) {
  const { dict } = useI18n();
  const [active, setActive] = useState(consent.status === "active");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = active
        ? await revokeMonitoringWatchAction()
        : await enableMonitoringWatchAction();
      if (result.ok) setActive((value) => !value);
      else setError(result.error ?? dict.settings.watchError);
    });
  }

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-surface p-5",
        active ? "border-accent/40" : "border",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">{dict.settings.watchTitle}</h2>
          {active && consent.consented_at ? (
            <p className="text-xs text-accent">
              {interpolate(dict.settings.watchSince, {
                date: formatDate(consent.consented_at),
              })}
            </p>
          ) : (
            <p className="text-xs text-faint">{dict.settings.watchRevokedLabel}</p>
          )}
        </div>
        <span
          aria-hidden
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold",
            active
              ? "bg-accent-soft text-accent"
              : "bg-sunken text-faint",
          )}
        >
          {active ? dict.settings.watchOnLabel : dict.settings.watchRevokedLabel}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-muted">
        {dict.settings.watchBody}
      </p>
      <p className="text-xs text-faint">{dict.settings.watchStaff}</p>
      <p className="text-xs text-faint">{dict.settings.watchScopeNote}</p>

      {!active && (
        <p className="text-xs text-faint">{dict.settings.watchOffHint}</p>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div>
        <button
          type="button"
          disabled={pending}
          onClick={toggle}
          className={cn(
            "rounded-xl px-4 py-2.5 text-sm font-medium transition disabled:opacity-50",
            active
              ? "border border-danger/40 text-danger hover:bg-danger-soft"
              : "bg-accent text-accent-contrast hover:bg-accent-strong",
          )}
        >
          {pending
            ? dict.common.working
            : active
              ? dict.settings.watchRevoke
              : dict.settings.watchEnable}
        </button>
      </div>
    </section>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}