"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { closeJobAction } from "@/app/actions/jobs";
import { useI18n } from "@/components/i18n-provider";
import { jobStatusLabel } from "@/lib/format";

export function JobOwnerActions({
  jobId,
  status,
}: {
  jobId: string;
  status: string;
}) {
  const { dict } = useI18n();
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const closed = current !== "open";
  const statusLabel = jobStatusLabel(current, dict);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`/jobs/${jobId}/applications`}
        className="h-10 rounded-xl border border-line px-4 text-sm font-medium transition hover:border-accent hover:text-accent"
      >
        {dict.jobs.reviewApplicants}
      </Link>

      {!closed && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await closeJobAction({ jobId });
              if (result.ok) setCurrent("cancelled");
              else setError(result.error ?? dict.jobs.couldNotClose);
            })
          }
          className="h-10 rounded-xl border border-line px-4 text-sm text-muted transition hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          {pending ? dict.jobs.closing : dict.jobs.close}
        </button>
      )}

      {closed && (
        <span className="rounded-full bg-sunken px-3 py-1.5 text-[11px] capitalize text-faint">
          {statusLabel}
        </span>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}