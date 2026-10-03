import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { requireOnboarded } from "@/lib/dal";
import { formatMoney, relativeTime } from "@/lib/format";
import { interpolate } from "@/lib/i18n/interpolate";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Job } from "@/lib/types";

export const metadata = { title: "Jobs — Steadfast" };

function jobTypeLabel(type: string, dict: Dictionary): string {
  const known = dict.jobTypes as Record<string, string | undefined>;
  return known[type] ?? type;
}

export default async function JobsPage() {
  await requireOnboarded();

  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, title, description, price_minor, currency, price_type, job_type, status, is_ai_clean, applications_count, created_at, category_id, user_id, estimated_hours, deadline_at",
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: categories } = await supabase
    .from("job_categories")
    .select("id, slug, name");

  const categoryName = new Map(
    (categories ?? []).map((c) => [c.id, c.name]),
  );

  const jobs = (data ?? []) as Job[];

  return (
    <main className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{dict.jobs.title}</h1>
          <p className="text-sm text-muted">{dict.jobs.listIntro}</p>
        </div>
        <Link
          href="/jobs/new"
          className="h-10 shrink-0 rounded-xl border border-line px-3 text-sm font-medium transition hover:border-accent hover:text-accent"
        >
          {dict.jobs.post}
        </Link>
      </header>

      {jobs.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted">
          {dict.jobs.emptyCta}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="flex flex-col gap-2 rounded-2xl border bg-surface p-4 shadow-sm transition hover:border-accent/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold leading-snug">
                    {job.title}
                  </h2>
                  <span className="shrink-0 text-sm font-semibold text-accent">
                    {formatMoney(job.price_minor, job.currency, job.price_type, dict, locale)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
                  <span className="rounded-full bg-sunken px-2 py-0.5">
                    {jobTypeLabel(job.job_type, dict)}
                  </span>
                  {job.category_id !== null && categoryName.get(job.category_id) && (
                    <span className="rounded-full bg-sunken px-2 py-0.5">
                      {categoryName.get(job.category_id)}
                    </span>
                  )}
                  {job.estimated_hours !== null && (
                    <span>{interpolate(dict.jobs.approxHours, { n: job.estimated_hours })}</span>
                  )}
                  <span>· {relativeTime(job.created_at, dict, locale)}</span>
                  <span>
                    · {interpolate(dict.jobs.appliedCount, { n: job.applications_count })}
                  </span>
                </div>

                <p className="line-clamp-2 text-sm leading-relaxed text-muted">
                  {job.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}