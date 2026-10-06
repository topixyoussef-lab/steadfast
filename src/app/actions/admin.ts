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

// ============================================================
// Room switches
// ============================================================
// Three independent switches per room, all of which are read on the server by
// both /api/moderate and /api/media/upload. Hiding a button is a courtesy to
// the member; these rows are the control.
//
//   chat_locked    the room takes no new messages from anybody, staff included.
//                  Reading is untouched: the room and its history stay visible.
//   voice_enabled  the room takes no voice notes. Ignored when chat_locked.
//   media_enabled  the room takes no photos or videos. Ignored when chat_locked.
//
// chat_locked is the one that is deliberately not a moderation setting: it does
// not change what is allowed, it stops anything being posted at all.

const roomSwitchSchema = z.object({
  roomId: z.string().uuid(),
  value: z.boolean(),
});

type RoomSwitch = "chat_locked" | "voice_enabled" | "media_enabled";

/**
 * Shared body for the three switches.
 *
 * Admin only, matching setMemberRoleAction: a moderator can act on members and
 * on messages, but closing a room is a decision about who gets to speak, so it
 * sits with the same role that can hand out privileges. Note that
 * `rooms_admin_write` itself is `private.is_admin()`, which includes
 * moderators -- this check is what makes it narrower than that policy, and it is
 * the server, so it is the part that actually holds.
 *
 * The write runs on the user client rather than service_role, so a policy that
 * stops covering rooms would make these fail closed rather than quietly bypass
 * it, and `.select("id")` turns "matched nothing" into an explicit failure
 * instead of a silent no-op that reports success.
 */
async function setRoomSwitch(
  column: RoomSwitch,
  input: { roomId: string; value: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const parsed = roomSwitchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown room" };

  const staff = await requireStaff();
  if (staff.role !== "admin") {
    return { ok: false, error: "Only admins can change room settings" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rooms")
    .update({ [column]: parsed.data.value })
    .eq("id", parsed.data.roomId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (didNotApply(data)) return { ok: false, error: "That room could not be updated" };

  revalidatePath("/admin/rooms");
  revalidatePath("/community");
  // The list of rooms and every individual room page read the same row, and the
  // slug of the room that changed is not known here, so the whole segment is
  // invalidated rather than a path that happens to match one room.
  revalidatePath("/community", "layout");
  return { ok: true };
}

export async function setRoomChatLockedAction(input: {
  roomId: string;
  locked: boolean;
}) {
  return setRoomSwitch("chat_locked", {
    roomId: input.roomId,
    value: input.locked,
  });
}

export async function setRoomVoiceEnabledAction(input: {
  roomId: string;
  enabled: boolean;
}) {
  return setRoomSwitch("voice_enabled", {
    roomId: input.roomId,
    value: input.enabled,
  });
}

export async function setRoomMediaEnabledAction(input: {
  roomId: string;
  enabled: boolean;
}) {
  return setRoomSwitch("media_enabled", {
    roomId: input.roomId,
    value: input.enabled,
  });
}

// ============================================================
// Broadcast + maintenance
// ============================================================
// Console-only outbox: a notification delivered to one member or to everyone,
// and two irrecoverable storage cleanups. These run on the service role where
// the member UI cannot reach (storage objects live behind the storage API,
// which has no member policy at all), made safe by an explicit admin-role
// check before anything is touched. The moderation log purge runs on the user
// client so RLS still has a say; everything else here has to bypass RLS, and
// the role check is the floor, matching setRoomSwitch.

const broadcastSchema = z.object({
  title: z.string().trim().min(1, "Write a title").max(120),
  body: z.string().trim().max(2000).optional(),
  link: z.string().trim().max(500).optional(),
  userId: z.string().uuid().nullable().optional(),
});

/**
 * Send an in-app notification to one member, or to every member when userId
 * is null. The write goes through admin_broadcast_notifications (0010) because
 * notifications has no INSERT policy by design; the function re-checks the
 * role so a future caller cannot forget.
 */
export async function sendBroadcastAction(input: {
  title: string;
  body?: string;
  link?: string;
  userId?: string | null;
}): Promise<{ ok: boolean; count?: number; error?: string }> {
  const parsed = broadcastSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid message" };
  }

  const staff = await requireStaff();
  if (staff.role !== "admin") {
    return { ok: false, error: "Only admins can send console messages" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_broadcast_notifications", {
    p_title: parsed.data.title,
    p_body: parsed.data.body || null,
    p_link: parsed.data.link || null,
    p_user_id: parsed.data.userId || null,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/messages");
  return { ok: true, count: typeof data === "number" ? data : 0 };
}

/** A filter the wipe can hunt everything with, without naming a real row. */
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Delete every chat message and every stored file, reclaiming real storage.
 *
 * Ordering matters: the object removal happens first so the rows are still
 * reachable to list, then message rows go (their attachment rows cascade),
 * then the buckets are empty too. A partial object removal refuses the whole
 * operation rather than leaving orphaned bytes behind.
 */
export async function clearAllChatMessagesAction(): Promise<{
  ok: boolean;
  messages?: number;
  files?: number;
  error?: string;
}> {
  const staff = await requireStaff();
  if (staff.role !== "admin") {
    return { ok: false, error: "Only admins can clear the chat" };
  }

  const admin = await createServiceRoleClient();

  // PostgREST caps a plain select at 1000 rows, and a wipe that forgets the
  // 1001st file leaves orphans in the bucket, so walk the attachment table in
  // pages and take the storage objects out in the same batch size.
  const storagePaths: string[] = [];let from = 0;
  for (;;) {
    const { data: objects, error: objectError } = await admin
      .from("chat_message_attachments")
      .select("storage_path")
      .order("id")
      .range(from, from + 999);

    if (objectError) return { ok: false, error: objectError.message };

    storagePaths.push(
      ...(objects ?? [])
        .map((row) => (row as { storage_path?: string }).storage_path)
        .filter((path): path is string => Boolean(path)),
    );

    if (!objects || objects.length < 1000) break;
    from += 1000;
  }

  let filesRemoved = 0;
  for (let start = 0; start < storagePaths.length; start += 1000) {
    const { error } = await admin.storage
      .from("chat-media")
      .remove(storagePaths.slice(start, start + 1000));
    if (error) {
      return {
        ok: false,
        error: "Some files could not be deleted; nothing was cleared.",
      };
    }
    filesRemoved += Math.min(1000, storagePaths.length - start);
  }

  const { count, error } = await admin
    .from("chat_messages")
    .delete({ count: "exact" })
    .neq("id", ZERO_UUID);

  if (error) return { ok: false, error: error.message };

  // Staged upload rows (a file uploaded but the message never posted) have no
  // message to cascade from, so remove them explicitly. Their objects were
  // already taken out above.
  const { error: stagedError } = await admin
    .from("chat_message_attachments")
    .delete()
    .is("message_id", null);

  if (stagedError) return { ok: false, error: stagedError.message };

  revalidatePath("/admin/moderation");
  revalidatePath("/community", "layout");
  return { ok: true, messages: count ?? 0, files: filesRemoved };
}

/**
 * Empty the moderation log.
 *
 * Run on the user client so the RLS policy (0007) is what actually allows it,
 * and the admin-role check above is the first gate rather than the only one.
 */
export async function clearAllModerationLogAction(): Promise<{
  ok: boolean;
  deleted?: number;
  error?: string;
}> {
  const staff = await requireStaff();
  if (staff.role !== "admin") {
    return { ok: false, error: "Only admins can clear the moderation log" };
  }

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("moderation_log")
    .delete({ count: "exact" })
    .gt("id", 0);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/moderation");
  return { ok: true, deleted: count ?? 0 };
}