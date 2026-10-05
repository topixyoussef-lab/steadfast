"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { moderateMessage } from "@/lib/python-client";

export type JobState = {
  error?: string;
  fieldErrors?: {
    title?: string[];
    description?: string[];
    price?: string[];
    jobType?: string[];
    categoryId?: string[];
    estimatedHours?: string[];
  };
  ok?: boolean;
};

const schema = z.object({
  title: z
    .string()
    .trim()
    .min(5, "Give the job a clear title")
    .max(120, "Keep the title under 120 characters"),
  description: z
    .string()
    .trim()
    .min(20, "Describe the work in at least 20 characters")
    .max(4000, "Keep the description under 4000 characters"),
  // Accepts "25" for $25.00 and "25.50" for $25.50, then stores minor units.
  price: z.coerce.number().min(0, "Price cannot be negative").max(100_000, "That price looks too high"),
  priceType: z.enum(["fixed", "hourly", "negotiable"]),
  jobType: z.enum(["micro", "gig", "part_time", "full_time", "internship"]),
  categoryId: z.coerce.number().int().positive(),
  estimatedHours: z.coerce.number().min(0).max(2000).optional(),
});

export async function postJobAction(
  _prev: JobState,
  formData: FormData,
): Promise<JobState> {
  const parsed = schema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    price: formData.get("price") || 0,
    priceType: formData.get("priceType"),
    jobType: formData.get("jobType"),
    categoryId: formData.get("categoryId"),
    estimatedHours: formData.get("estimatedHours") || undefined,
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        title: flat.title,
        description: flat.description,
        price: flat.price,
        jobType: flat.jobType,
        categoryId: flat.categoryId,
        estimatedHours: flat.estimatedHours,
      },
    };
  }

  const { priceType } = parsed.data;

  // The database has a CHECK that a priced job must carry a positive amount.
  if (priceType !== "negotiable" && parsed.data.price <= 0) {
    return { fieldErrors: { price: ["Enter a price, or mark it negotiable"] } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your session expired. Sign in again." };
  }

  // Job descriptions are the one place a stranger can ask a recovering
  // member for money or for content, so they go through the same moderation
  // gate as chat. A blocked listing is never written at all.
  const verdict = await moderateMessage(
    `${parsed.data.title}\n\n${parsed.data.description}`,
    { userId: user.id },
  );

  if (verdict?.decision === "block") {
    return {
      fieldErrors: {
        description: [
          verdict.reason ?? "This listing cannot be posted.",
        ],
      },
      error: verdict.reason ?? "This listing cannot be posted.",
    };
  }

  const { error } = await supabase.from("jobs").insert({
    user_id: user.id,
    category_id: parsed.data.categoryId,
    job_type: parsed.data.jobType,
    title: parsed.data.title,
    description: parsed.data.description,
    price_minor: Math.round(parsed.data.price * 100),
    currency: "USD",
    price_type: priceType,
    estimated_hours: parsed.data.estimatedHours ?? null,
    // Only an explicit pass counts as clean. If moderation was unavailable we
    // store the listing unverified rather than vouching for it.
    is_ai_clean: verdict?.decision === "allow",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/jobs");
  return { ok: true };
}

const applySchema = z.object({
  jobId: z.string().uuid("Unknown job"),
  message: z.string().trim().max(1000).optional(),
});

export async function applyToJobAction(
  _prev: JobState,
  formData: FormData,
): Promise<JobState> {
  const parsed = applySchema.safeParse({
    jobId: formData.get("jobId"),
    message: formData.get("message") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid application" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your session expired. Sign in again." };
  }

  const { data: job } = await supabase
    .from("jobs")
    .select("id, user_id, status")
    .eq("id", parsed.data.jobId)
    .single<{ id: string; user_id: string; status: string }>();

  if (!job || job.status !== "open") {
    return { error: "This job is no longer open." };
  }
  if (job.user_id === user.id) {
    return { error: "You cannot apply to your own job." };
  }

  const { error } = await supabase.from("job_applications").insert({
    job_id: job.id,
    user_id: user.id,
    message: parsed.data.message ?? null,
  });

  if (error) {
    // The unique (job_id, user_id) constraint is what stops double applies.
    if (error.code === "23505") {
      return { error: "You have already applied to this job." };
    }
    return { error: error.message };
  }

  revalidatePath(`/jobs/${job.id}`);
  return { ok: true };
}

const reviewSchema = z.object({
  applicationId: z.string().uuid(),
  status: z.enum(["accepted", "rejected", "withdrawn"]),
});

/**
 * Review an applicant. The notifications and the applications_count update
 * both fire from the 0002 triggers, so this action only has to write the row.
 */
export async function reviewApplicationAction(input: {
  applicationId: string;
  status: "accepted" | "rejected" | "withdrawn";
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "That action is not valid" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not signed in" };
  }

  // RLS (applications_update_own_or_owner) scopes this to the applicant or the
  // person who posted the job. The guard trigger is what stops an applicant
  // from writing 'accepted' on their own row.
  const { data: updated, error } = await supabase
    .from("job_applications")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.applicationId)
    .select("job_id")
    .single<{ job_id: string }>();

  if (error) {
    return { ok: false, error: error.message };
  }

  // The poster's inbox and the job page both show this state.
  revalidatePath(`/jobs/${updated.job_id}/applications`);
  revalidatePath(`/jobs/${updated.job_id}`);
  return { ok: true };
}

/**
 * Withdraw a listing from the market.
 *
 * job_status has no 'closed' member, so "closed" in the UI maps to
 * 'cancelled' here. RLS (jobs_update_own) means only the poster can do this.
 */
export async function closeJobAction(input: { jobId: string }) {
  const jobId = z.string().uuid().safeParse(input.jobId);
  if (!jobId.success) return { ok: false, error: "Unknown job" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data, error } = await supabase
    .from("jobs")
    .update({ status: "cancelled" })
    .eq("id", jobId.data)
    .select("id");

  // An RLS-filtered write updates zero rows and still reports success, so the
  // returned row is what proves the poster was actually allowed to do this.
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "That listing is not yours to close" };
  }

  revalidatePath(`/jobs/${jobId.data}`);
  revalidatePath("/jobs");
  return { ok: true };
}