"use client";

import { useEffect, useRef, useState } from "react";
import { useOffline } from "next/offline";

import { useI18n } from "@/components/i18n-provider";

/**
 * Explains why the app feels stuck while the connection is down.
 *
 * With experimental.useOffline on, a Server Action that fails on the network no
 * longer rejects — it stays pending and retries when connectivity returns. That
 * is the behaviour we want for a check-in or a panic alert, but from the inside
 * it is indistinguishable from a dead button, and the people most likely to be
 * offline are the ones least able to guess that pressing again is unnecessary.
 *
 * So the banner states the two facts: you are offline, and what you submit is
 * being held rather than lost.
 *
 * The hook is not `navigator.onLine`. It also flips on a request that fails
 * while the OS still reports a live interface — a captive portal or a dead
 * upstream — which is the case where `navigator.onLine` cheerfully says true.
 *
 * The confirmation is local rather than fetched. Any request to find out would
 * either fail for the same reason the banner is showing or, worse, hit the
 * origin and count as the framework's own reconnection check.
 */
export function OfflineBanner() {
  const { dict } = useI18n();
  const isOffline = useOffline();
  // `wasOffline` lives in a ref because nothing renders from it: it only records
  // that a genuine outage happened, so the recovery message below is not shown on
  // the first online render. Deriving it with useState would mean mirroring the
  // hook's value through an effect, which is the cascading-render trap the lint
  // rule is about, and it would still need the effect to set it.
  const wasOffline = useRef(false);
  const [backOnline, setBackOnline] = useState(false);

  useEffect(() => {
    if (isOffline) {
      wasOffline.current = true;
      return;
    }

    // Only speak up on a real recovery, not on the initial online render. The
    // hook reads false through SSR and hydration, so without this the app would
    // greet a signed-in member with "Back online" on every single load.
    if (!wasOffline.current) return;

    setBackOnline(true);
    const timer = setTimeout(() => {
      setBackOnline(false);
      wasOffline.current = false;
    }, 4000);
    return () => clearTimeout(timer);
  }, [isOffline]);

  if (!isOffline && !backOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 border-b border-line bg-surface px-4 py-2 safe-t shadow-sm"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-0.5">
        <p className="text-xs font-semibold tracking-tight">
          {isOffline ? dict.offline.banner : dict.offline.back}
        </p>
        {isOffline && (
          <p className="text-xs text-muted">{dict.offline.retrying}</p>
        )}
      </div>
    </div>
  );
}
