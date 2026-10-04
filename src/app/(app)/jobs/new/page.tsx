import Link from "next/link";

import { PostJobForm } from "@/components/jobs/post-job-form";
import { createClient } from "@/lib/supabase/server";
import { requireOnboarded } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";
import { jobCategoryLabel } from "@/lib/format";
import type { JobCategory } from "@/lib/types";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.jobs.newTitle };
}

export default async function NewJobPage() {
  await requireOnboarded();

  const dict = await getDictionary();
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_categories")
    .select("id, slug, name")
    .order("name");

  const categories = (data ?? []) as JobCategory[];

  return (
    <main className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-2">
        <Link href="/jobs" className="text-sm text-muted hover:text-ink">
          <span aria-hidden="true">&larr;</span> {dict.jobs.backToJobs}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.jobs.newTitle}
        </h1>
        <p className="text-sm text-muted">{dict.jobs.newIntro}</p>
      </header>

      <PostJobForm
        categories={categories.map((category) => ({
          ...category,
          name: jobCategoryLabel(category.slug, category.name, dict),
        }))}
      />
    </main>
  );
}