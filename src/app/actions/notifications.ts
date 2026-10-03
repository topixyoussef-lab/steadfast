"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  // Optional on purpose: omitting it marks the whole inbox, which is what the
  // "mark all read" button does. Only validate the shape when it is present.
  notificationId: z.string().uuid().optional(),
});

export async function markNotificationsReadAction(input: {
  notificationId?: string;
}) {
  const parsed = schema.safeParse({ notificationId: input.notificationId ?? null });
  if (!parsed.success) return { ok: false as const };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const };

  const query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  // RLS scopes this to the caller's own rows, so omitting the id marks
  // everything the member has, and nothing anyone else's.
  const { error } = parsed.data.notificationId
    ? await query.eq("id", parsed.data.notificationId)
    : await query.eq("user_id", user.id);

  if (error) return { ok: false as const };

  revalidatePath("/notifications");
  return { ok: true as const };
}