"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
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
 *
 * Both moderation paths revalidate the console root and the moderation page,
 * because a delete made here is also what removes the row from the flagged
 * list. Revalidating only "/admin" leaves the console showing a row that no
 * longer exists until someone reloads by hand.
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
  revalidatePath("/admin/moderation");
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
  revalidatePath("/admin/moderation");
  return { ok: true };
}

const logRowSchema = z.object({
  logId: z.string().regex(/^\d+$/, "Unknown log row"),
});

/**
 * Remove one row from the moderation log.
 *
 * The log row is the audit record, so this is a purge rather than a review
 * action: `content_preview` is a copy of the message text and goes with it.
 * `private.is_admin()` on 0007 is what authorises this, since the write runs on
 * the user client and not on service_role.
 *
 * Note the id is a bigserial, not a uuid, so it is validated as digits rather
 * than with z.string().uuid().
 */
export async function deleteModerationLogAction(input: { logId: string }) {
  const parsed = logRowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown log row" };

  await requireStaff();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("moderation_log")
    .delete()
    .eq("id", parsed.data.logId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That log row is already gone" };

  revalidatePath("/admin/moderation");
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

const roleSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["user", "admin"]),
});

/**
 * Grant or revoke the admin role.
 *
 * Gated to `admin`, not staff: moderators get the console but not the ability
 * to hand out privileges. A member cannot change their own role either, so the
 * last admin can never demote themselves out of the console by accident. The
 * write still runs on the user client, so if profiles_admin_all were ever
 * mis-scoped this fails closed rather than bypassing it.
 */
export async function setMemberRoleAction(input: {
  userId: string;
  role: "user" | "admin";
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid role" };

  const staff = await requireStaff();
  if (staff.role !== "admin") {
    return { ok: false, error: "Only admins can change roles" };
  }
  if (staff.id === parsed.data.userId) {
    return { ok: false, error: "You cannot change your own role" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.userId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That member could not be updated" };

  revalidatePath("/admin/members");
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { ok: true };
}

const notificationSchema = z.object({
  notificationId: z.string().uuid(),
});

/**
 * Clear one notification out of a member's history.
 *
 * RLS authorises this through notifications_admin_delete on 0008. There was no
 * delete policy for notifications before that, not even for the member's own
 * rows, so this would otherwise fail closed.
 */
export async function deleteNotificationAction(input: {
  notificationId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = notificationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown notification" };

  await requireStaff();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", parsed.data.notificationId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That notification is already gone" };

  revalidatePath("/admin");
  return { ok: true };
}

const clearNotificationsSchema = z.object({ userId: z.string().uuid() });

/**
 * Clear every notification a member has accumulated.
 *
 * This one goes through the security-definer admin_clear_notifications rather
 * than the table. Staff cannot read another member's notifications by table, so
 * the action would have no way to count first and would report success for an
 * RLS-denied no-op. The function deletes and returns the affected count in one
 * round trip, and raises if the member does not exist.
 */
export async function clearAllNotificationsAction(input: {
  userId: string;
}): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  const parsed = clearNotificationsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown member" };

  await requireStaff();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_clear_notifications", {
    p_user_id: parsed.data.userId,
  });

  if (error) return { ok: false, error: error.message };

  const deleted = typeof data === "number" ? data : 0;
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { ok: true, deleted };
}

const accountSchema = z.object({ userId: z.string().uuid() });

/**
 * Delete a member's account for good.
 *
 * The only action here that needs service_role, because the row that has to go
 * is an auth.users row. PostgREST cannot reach the auth schema with the anon
 * key at all, and deleting just the profiles row would leave an orphaned
 * sign-in behind: the member could no longer be traced, and the account would
 * linger with no way to purge it. auth.admin.deleteUser is the call that
 * actually removes it, and the schema does the rest — profiles and every table
 * with `references public.profiles(id) on delete cascade` (chat_messages,
 * notifications, panic_alerts, checkins, task_completions, jobs, applications)
 * go with it in the same transaction.
 *
 * What deliberately survives: moderation_log.user_id is `on delete set null`, so
 * the moderation history stays as an orphaned audit trail with its
 * content_preview intact. That is why the moderation console has its own
 * delete, and why purging the log is a separate decision from purging the
 * person.
 *
 * Guards, in order: a staff session, admin only (matching setMemberRoleAction,
 * since moderators can act on members but cannot hand out privileges), never
 * yourself, and never the last admin — that one would lock every remaining
 * moderator out of the console with nobody left to appoint a replacement.
 */
export async function deleteMemberAccountAction(input: {
  userId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown member" };

  const staff = await requireStaff();
  if (staff.role !== "admin") {
    return { ok: false, error: "Only admins can delete accounts" };
  }
  if (staff.id === parsed.data.userId) {
    return { ok: false, error: "You cannot delete your own account" };
  }

  const admin = await createServiceRoleClient();

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (!targetProfile) return { ok: false, error: "That member no longer exists" };

  if (targetProfile.role === "admin") {
    const { count, error: countError } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    if (countError) return { ok: false, error: countError.message };
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "That is the last admin, so it cannot be deleted" };
    }
  }

  const { error } = await admin.auth.admin.deleteUser(parsed.data.userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/members");
  return { ok: true };
}