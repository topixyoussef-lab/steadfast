import Link from "next/link";
import { notFound } from "next/navigation";

import { ApplyForm } from "@/components/jobs/apply-form";
import { JobOwnerActions } from "@/components/jobs/job-owner-actions";
import { createClient } from "@/lib/supabase/server";
import { requireOnboarded } from "@/lib/dal";
import { formatMoney, jobStatusLabel, relativeTime } from "@/lib/format";
import { intlLocale } from "@/lib/i18n/config";
import { interpolate } from "@/lib/i18n/interpolate";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Job, JobApplication } from "@/lib/types";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.jobs.title };
}

function jobTypeLabel(type: string, dict: Dictionary): string {
  const known = dict.jobTypes as Record<string, string | undefined>;
  return known[type] ?? type;
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireOnboarded();
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, user_id, category_id, job_type, title, description, price_minor, currency, price_type, status, is_ai_clean, estimated_hours, deadline_at, applications_count, created_at",
    )
    .eq("id", id)
    .single<Job>();

  if (!job) notFound();
  if (job.status !== "open" && job.user_id !== profile.id) notFound();

  const { data: category } = job.category_id
    ? await supabase
        .from("job_categories")
        .select("name")
        .eq("id", job.category_id)
        .single()
    : { data: null };

  const { data: mine } = await supabase
    .from("job_applications")
    .select("id, status")
    .eq("job_id", job.id)
    .eq("user_id", profile.id)
    .single<Pick<JobApplication, "id" | "status">>();

  const isOwner = job.user_id === profile.id;

  return (
    <main className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-2">
        <Link href="/jobs" className="text-sm text-muted hover:text-ink">
          ← {dict.jobs.backToJobs}
        </Link>
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          {job.title}
        </h1>
        <p className="text-2xl font-semibold text-accent">
          {formatMoney(job.price_minor, job.currency, job.price_type, dict, locale)}
          {job.price_type === "hourly" && (
            <span className="text-sm font-normal text-muted">{dict.jobs.perHour}</span>
          )}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
        <span className="rounded-full bg-sunken px-2.5 py-1">
          {jobTypeLabel(job.job_type, dict)}
        </span>
        {category?.name && (
          <span className="rounded-full bg-sunken px-2.5 py-1">{category.name}</span>
        )}
        {job.estimated_hours !== null && (
          <span>{interpolate(dict.jobs.approxHoursLong, { n: job.estimated_hours })}</span>
        )}
        <span>{interpolate(dict.jobs.postedAt, { when: relativeTime(job.created_at, dict, locale) })}</span>
      </div>

      <section className="whitespace-pre-wrap rounded-2xl border bg-surface p-5 text-sm leading-relaxed">
        {job.description}
      </section>

      {job.deadline_at && (
        <p className="text-sm text-muted">
          {interpolate(dict.jobs.applicationsClose, {
            date: new Date(job.deadline_at).toLocaleDateString(intlLocale[locale], {
              month: "long",
              day: "numeric",
            }),
          })}
        </p>
      )}

      {isOwner ? (
        <div className="flex flex-col gap-3">
          <p className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">
            {interpolate(dict.jobs.yourListing, { n: job.applications_count })}
          </p>
          <JobOwnerActions jobId={job.id} status={job.status} />
        </div>
      ) : mine ? (
        <p className="rounded-2xl border bg-surface px-4 py-3 text-sm text-muted">
          {interpolate(dict.jobs.youApplied, { status: jobStatusLabel(mine.status, dict) })}
        </p>
      ) : job.status === "open" ? (
        <ApplyForm jobId={job.id} />
      ) : (
        <p className="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted">
          {dict.jobs.noLongerOpen}
        </p>
      )}
    </main>
  );
}