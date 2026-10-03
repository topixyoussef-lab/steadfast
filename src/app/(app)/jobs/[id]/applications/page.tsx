import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ApplicationRow } from "@/components/jobs/application-row";
import { JobOwnerActions } from "@/components/jobs/job-owner-actions";
import { createClient } from "@/lib/supabase/server";
import { requireOnboarded } from "@/lib/dal";
import { formatMoney, relativeTime } from "@/lib/format";
import { interpolate } from "@/lib/i18n/interpolate";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import type { Job } from "@/lib/types";

export const metadata = { title: "Applicants — Steadfast" };

type Application = {
  id: string;
  job_id: string;
  user_id: string;
  message: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  created_at: string;
};

export default async function ApplicationsPage({
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
      "id, user_id, title, price_minor, currency, price_type, status, applications_count, created_at",
    )
    .eq("id", id)
    .single<Job>();

  if (!job) notFound();

  // The applications_read policy also allows the applicant and staff, but
  // this screen is the poster's inbox, so anyone else goes back to the job.
  if (job.user_id !== profile.id) {
    redirect(`/jobs/${job.id}`);
  }

  const { data: applications } = await supabase
    .from("job_applications")
    .select("id, job_id, user_id, message, status, created_at")
    .eq("job_id", job.id)
    .order("created_at", { ascending: false });

  const rows = (applications ?? []) as Application[];
  const pending = rows.filter((r) => r.status === "pending");
  const decided = rows.filter((r) => r.status !== "pending");

  return (
    <main className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-2">
        <Link href={`/jobs/${job.id}`} className="text-sm text-muted hover:text-ink">
          ← {job.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{dict.jobs.applicants}</h1>
        <p className="text-sm text-muted">
          {interpolate(dict.jobs.applicantsMeta, {
            money: formatMoney(job.price_minor, job.currency, job.price_type, dict, locale),
            n: rows.length,
            when: relativeTime(job.created_at, dict, locale),
          })}
        </p>
      </header>

      <JobOwnerActions jobId={job.id} status={job.status} />

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted">
          {dict.jobs.noApplicantsYet}
        </p>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">
                {dict.jobs.waitingOnYou}
                <span className="ms-2 text-sm font-normal text-muted">
                  {pending.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-3">
                {pending.map((row) => (
                  <li key={row.id}>
                    <ApplicationRow
                      application={row}
                      canDecide={job.user_id === profile.id}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {decided.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">
                {dict.jobs.decided}
                <span className="ms-2 text-sm font-normal text-muted">
                  {decided.length}
                </span>
              </h2>
              <ul className="flex flex-col gap-3">
                {decided.map((row) => (
                  <li key={row.id}>
                    <ApplicationRow application={row} canDecide={false} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <p className="border-t border-line pt-4 text-xs text-faint">
        {dict.jobs.applicantsNote}
      </p>
    </main>
  );
}