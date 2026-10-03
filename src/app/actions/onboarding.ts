"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type OnboardingState = {
  error?: string;
  fieldErrors?: {
    preference?: string[];
    displayName?: string[];
    weeklyGoal?: string[];
    timezone?: string[];
  };
};

const schema = z.object({
  preference: z.enum(["islamic", "christian", "general"], {
    error: "Choose a path to continue",
  }),
  displayName: z
    .string()
    .trim()
    .min(2, "Use at least 2 characters")
    .max(60, "Keep it under 60 characters"),
  weeklyGoal: z.coerce.number().int().min(1).max(7),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isValidTimeZone, "Unrecognised timezone"),
});

function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function completeOnboardingAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = schema.safeParse({
    preference: formData.get("preference"),
    displayName: formData.get("displayName"),
    weeklyGoal: formData.get("weeklyGoal"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        preference: flat.preference,
        displayName: flat.displayName,
        weeklyGoal: flat.weeklyGoal,
        timezone: flat.timezone,
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase.rpc("complete_onboarding", {
    p_preference: parsed.data.preference,
    p_display_name: parsed.data.displayName,
    p_timezone: parsed.data.timezone,
    p_weekly_goal: parsed.data.weeklyGoal,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
