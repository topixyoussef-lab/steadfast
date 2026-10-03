"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { CheckinResult } from "@/lib/types";

export type CheckinState = {
  error?: string;
  fieldErrors?: {
    mood?: string[];
    urgeLevel?: string[];
    note?: string[];
  };
  result?: CheckinResult;
};

const schema = z.object({
  mood: z.coerce.number().int().min(1).max(10).optional(),
  urgeLevel: z.coerce.number().int().min(0).max(10).optional(),
  note: z
    .string()
    .trim()
    .max(500, "Keep it under 500 characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/**
 * The streak is computed entirely in record_checkin(). The client cannot
 * influence it, and the same day can be checked in repeatedly without
 * inflating the streak.
 */
export async function recordCheckinAction(
  _prev: CheckinState,
  formData: FormData,
): Promise<CheckinState> {
  const parsed = schema.safeParse({
    mood: formData.get("mood") ?? undefined,
    urgeLevel: formData.get("urgeLevel") ?? undefined,
    note: formData.get("note") ?? undefined,
  });

  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        mood: flat.mood,
        urgeLevel: flat.urgeLevel,
        note: flat.note,
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your session expired. Sign in again." };
  }

  const { data, error } = await supabase.rpc("record_checkin", {
    p_mood: parsed.data.mood ?? null,
    p_urge_level: parsed.data.urgeLevel ?? null,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard");

  return { result: (data as CheckinResult) ?? undefined };
}
