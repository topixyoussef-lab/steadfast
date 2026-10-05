"use client";

import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/components/i18n-provider";

const POLL_MS = 5 * 60 * 1000;

/**
 * Offers a reload when a newer build has been deployed than the one running.
 *
 * The installed app is a TWA over the live site, so it has no store update to
 * wait for — but a page left open keeps running the old bundle until it is
 * reloaded, which is what makes a fix look like it did not ship. The stamp this
 * component was built with is inlined at build time; /api/version answers from
 * the running deployment, so the two disagree exactly when an update is waiting.
 *
 * Polling is deliberately lazy: once on mount, then on a slow interval and
 * whenever the app comes back to the foreground, which is how a phone is
 * actually used.
 */
export function UpdatePrompt() {
  const { dict } = useI18n();
  const t = dict.update;

  const shipped = process.env.NEXT_PUBLIC_BUILD_STAMP;
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const checking = useRef(false);

  useEffect(() => {
    if (!shipped || available) return;

    let active = true;

    const check = async () => {
      // Overlapping polls would only re-report the same answer.
      if (checking.current) return;
      checking.current = true;

      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;

        const { stamp } = (await response.json()) as { stamp?: string };
        if (stamp && stamp !== shipped && active) setAvailable(true);
      } catch {
        // Offline, or a deploy in progress. The next check tries again.
      } finally {
        checking.current = false;
      }
    };

    void check();

    const timer = setInterval(check, POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [shipped, available]);

  if (!available || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface p-4 safe-b shadow-sm"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div>
          <p className="text-sm font-semibold tracking-tight">{t.title}</p>
          <p className="mt-0.5 text-sm text-muted">{t.body}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast transition hover:bg-accent-strong active:scale-[0.98]"
          >
            {t.reload}
          </button>

          <a
            href="/steadfast.apk"
            download
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-sunken"
          >
            {t.download}
          </a>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="ms-auto rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition hover:text-ink"
          >
            {t.later}
          </button>
        </div>
      </div>
    </div>
  );
}
