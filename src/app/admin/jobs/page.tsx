import Link from "next/link";

import { Badge, EmptyNote, Section } from "@/components/admin/dossier-ui";
import { requireStaff } from "@/lib/dal";
import { formatDate, formatMoney, jobCategoryLabel, jobStatusLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.console.jobs };
}

export default async function AdminJobsPage() {
  await requireStaff();
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);

  const supabase = await createClient();

  // Jobs are readable by staff regardless of status, so this covers the whole
  // board rather than just what is publicly open.
  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "id, user_id, category_id, title, job_type, status, price_minor, currency, price_type, is_ai_clean, applications_count, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: categories } = await supabase
    .from("job_categories")
    .select("id, slug, name");

  const nameById = new Map((categories ?? []).map((c) => [c.id, c]));

  const rows = jobs ?? [];
  const unclean = rows.filter((job) => !job.is_ai_clean);

  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.console.jobs}</h1>
        <p className="text-sm text-muted">{dict.console.jobsIntro}</p>
      </header>

      <Section title={dict.admin.user.aiChecked} count={rows.length}>
        {rows.length === 0 ? (
          <EmptyNote>{dict.admin.user.empty}</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-faint">
                  <th className="py-1.5 pe-3 text-start font-medium">
                    {dict.admin.user.headline}
                  </th>
                  <th className="py-1.5 pe-3 text-start font-medium">
                    {dict.admin.user.category}
                  </th>
                  <th className="py-1.5 pe-3 text-start font-medium">
                    {dict.admin.user.status}
                  </th>
                  <th className="py-1.5 pe-3 text-start font-medium">
                    {dict.admin.user.price}
                  </th>
                  <th className="py-1.5 pe-3 text-start font-medium">
                    {dict.admin.user.applications}
                  </th>
                  <th className="py-1.5 text-start font-medium">
                    {dict.admin.user.day}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((job) => {
                  const category = job.category_id
                    ? nameById.get(job.category_id)
                    : undefined;

                  return (
                    <tr key={job.id} className="border-b border-line/50 last:border-0">
                      <td className="py-2 pe-3">
                        <Link href={`/jobs/${job.id}`} className="hover:underline">
                          {job.title}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap py-2 pe-3 text-muted">
                        {category
                          ? jobCategoryLabel(category.slug, category.name, dict)
                          : dict.admin.user.notAvailable}
                      </td>
                      <td className="py-2 pe-3">
                        <Badge tone={job.status === "open" ? "good" : "neutral"}>
                          {jobStatusLabel(job.status, dict)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap py-2 pe-3 text-muted">
                        {formatMoney(job.price_minor, job.currency, job.price_type, dict, locale)}
                      </td>
                      <td className="py-2 pe-3 text-muted">{job.applications_count}</td>
                      <td className="whitespace-nowrap py-2 text-xs text-faint">
                        {formatDate(job.created_at, locale)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {unclean.length > 0 && (
        <Section title={dict.admin.user.aiChecked} count={unclean.length}>
          <ul className="flex flex-col divide-y divide-line/50">
            {unclean.map((job) => (
              <li key={job.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <Link href={`/jobs/${job.id}`} className="min-w-0 text-sm hover:underline">
                  {job.title}
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone="warning">{dict.admin.user.aiChecked}</Badge>
                  <span className="text-xs text-faint">{formatDate(job.created_at, locale)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </main>
  );
}