"use client";

import { useState, useTransition } from "react";

import { markNotificationsReadAction } from "@/app/actions/notifications";
import { useI18n } from "@/components/i18n-provider";

export function MarkReadButton() {
  const { dict } = useI18n();
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markNotificationsReadAction({});
          setDone(true);
        })
      }
      className="h-10 shrink-0 rounded-xl border border-line px-3 text-sm text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-60"
    >
      {pending ? dict.notifications.marking : dict.notifications.markAllRead}
    </button>
  );
}