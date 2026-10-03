"use client";

import { useState, useTransition } from "react";

import { reviewApplicationAction } from "@/app/actions/jobs";
import { applicationStatusLabel, pseudonym, relativeTime } from "@/lib/format";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";

type Application = {
  id: string;
  user_id: string;
  message: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  created_at: string;
};

const STATUS_STYLE: Record<Application["status"], string> = {
  pending: "bg-sunken text-faint",
  accepted: "bg-accent-soft text-accent",
  rejected: "bg-danger-soft text-danger",
  withdrawn: "bg-sunken text-faint",
};

export function ApplicationRow({
  application,
  canDecide,
}: {
  application: Application;
  canDecide: boolean;
}) {
  const { dict, locale } = useI18n();
  const [status, setStatus] = useState(application.status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(next: "accepted" | "rejected") {
    setError(null);
    startTransition(async () => {
      const result = await reviewApplicationAction({
        applicationId: application.id,
        status: next,
      });
      if (result.ok) {
        setStatus(next);
      } else {
        setError(result.error ?? dict.jobs.couldNotSave);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">
          {pseudonym(application.user_id, dict)}
        </span>
        <time className="text-[11px] text-faint" dateTime={application.created_at}>
          {relativeTime(application.created_at, dict, locale)}
        </time>
      </div>

      {application.message ? (
        <p className="text-sm leading-relaxed text-muted">{application.message}</p>
      ) : (
        <p className="text-sm italic text-faint">{dict.jobs.noNoteLeft}</p>
      )}

      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px]",
            STATUS_STYLE[status],
          )}
        >
          {applicationStatusLabel(status, dict)}
        </span>

        {canDecide && status === "pending" && (
          <>
            <button
              type="button"
              onClick={() => decide("accepted")}
              disabled={pending}
              className="h-9 rounded-xl bg-accent px-4 text-sm font-medium text-accent-contrast transition hover:bg-accent-strong disabled:opacity-50"
            >
              {dict.jobs.accept}
            </button>
            <button
              type="button"
              onClick={() => decide("rejected")}
              disabled={pending}
              className="h-9 rounded-xl border border-line px-4 text-sm text-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
            >
              {dict.jobs.decline}
            </button>
          </>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}