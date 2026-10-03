"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const taskId = z.string().uuid("That task id is not valid");

/**
 * Completion is one-way by design. complete_task() inserts into
 * task_completions and there is no un-complete path, because a member who
 * finished something today did finish it, whatever they feel at 2am.
 *
 * The RPC also triggers record_checkin() when the completion is new, so
 * doing a task keeps the streak alive on its own.
 */
export async function completeTaskAction(input: {
  taskId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = taskId.safeParse(input.taskId);
  if (!parsed.success) {
    return { ok: false, error: "That task id is not valid" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Your session expired. Sign in again." };
  }

  const { error } = await supabase.rpc("complete_task", {
    p_task_id: parsed.data,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
