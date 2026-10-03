"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/dal";

/**
 * Staff actions.
 *
 * Every one of these runs on the *user* client, not service_role, so the RLS
 * policies written in 0001 are what actually authorises the change. If a
 * policy is wrong, these fail closed instead of quietly bypassing it.
 *
 * Note the repeated `.select(...)` on the writes below. A write that RLS
 * filters out updates zero rows and still reports success, so without asking
 * for the row back a denied action would look like it worked.
 */

type Staff = Awaited<ReturnType<typeof requireStaff>>;

/** Turns "matched nothing" into an explicit failure instead of a silent no-op. */
function didNotApply(rows: unknown): boolean {
  return !Array.isArray(rows) || rows.length === 0;
}

const alertSchema = z.object({
  alertId: z.string().uuid(),
});

export async function acknowledgeAlertAction(input: { alertId: string }) {
  const parsed = alertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown alert" };

  const staff: Staff = await requireStaff();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("panic_alerts")
    .update({
      status: "acknowledged",
      // Recorded so the team can tell who picked it up during an incident.
      acknowledged_by: staff.id,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.alertId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That alert is no longer open" };

  revalidatePath("/admin");
  return { ok: true };
}

export async function resolveAlertAction(input: { alertId: string }) {
  const parsed = alertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown alert" };

  const staff: Staff = await requireStaff();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("panic_alerts")
    .update({
      status: "resolved",
      acknowledged_by: staff.id,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.alertId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That alert is no longer open" };

  revalidatePath("/admin");
  return { ok: true };
}

const messageSchema = z.object({ messageId: z.string().uuid() });

/**
 * Remove a message that should not have been posted.
 *
 * This is a hard delete because that is what chat_admin_delete permits, and
 * moderation_log already keeps a content preview, so the audit trail survives
 * the row. The member gets told rather than silently losing their message.
 */
export async function deleteMessageAction(input: { messageId: string }) {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown message" };

  await requireStaff();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("id", parsed.data.messageId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That message is already gone" };

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Clear a flagged message without removing it. Sets moderation_status back to
 * allowed, which fires the 0002 trigger and lets the member know it was
 * reviewed. This is the action moderators should reach for by default.
 */
export async function clearMessageAction(input: { messageId: string }) {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown message" };

  await requireStaff();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .update({ moderation_status: "allowed", is_flagged_by_ai: false })
    .eq("id", parsed.data.messageId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That message is gone" };

  revalidatePath("/admin");
  return { ok: true };
}

const suspendSchema = z.object({
  userId: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(365),
});

export async function suspendUserAction(input: {
  userId: string;
  days: number;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = suspendSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid suspension" };

  const staff = await requireStaff();
  if (staff.id === parsed.data.userId) {
    return { ok: false, error: "You cannot suspend yourself" };
  }

  const supabase = await createClient();
  const until = new Date(
    Date.now() + parsed.data.days * 86_400_000,
  ).toISOString();

  const { data, error } = await supabase
    .from("profiles")
    .update({ suspended_until: until })
    .eq("id", parsed.data.userId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That member could not be suspended" };

  revalidatePath("/admin");
  return { ok: true };
}

export async function liftSuspensionAction(input: { userId: string }) {
  const parsed = z.string().uuid().safeParse(input.userId);
  if (!parsed.success) return { ok: false, error: "Unknown member" };

  await requireStaff();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ suspended_until: null })
    .eq("id", parsed.data)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That member could not be reinstated" };

  revalidatePath("/admin");
  return { ok: true };
}