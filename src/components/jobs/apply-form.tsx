"use client";

import { useActionState } from "react";

import { applyToJobAction, type JobState } from "@/app/actions/jobs";
import { useI18n } from "@/components/i18n-provider";
import { FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function ApplyForm({ jobId }: { jobId: string }) {
  const { dict } = useI18n();
  const [state, formAction] = useActionState<JobState, FormData>(
    applyToJobAction,
    {},
  );

  if (state.ok) {
    return (
      <p
        role="status"
        className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent"
      >
        {dict.jobs.applicationSent}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="jobId" value={jobId} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="message" className="text-sm font-medium text-muted">
          {dict.jobs.whyYou}{" "}
          <span className="text-faint">({dict.common.optional})</span>
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          maxLength={1000}
          placeholder={dict.jobs.whyYouPlaceholder}
          className="w-full resize-none rounded-xl border border-line bg-surface px-4 py-3 text-base leading-relaxed focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
      </div>

      <FormError message={state.error} />
      <SubmitButton pendingLabel={dict.jobs.applyPending}>
        {dict.jobs.apply}
      </SubmitButton>
    </form>
  );
}