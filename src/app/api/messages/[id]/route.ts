import { NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { moderateMessage } from "@/lib/python-client";
import { logModeration } from "@/lib/moderation-log";
import { MESSAGE_COLUMNS, MESSAGE_COLUMNS_BASE } from "@/lib/chat";
import { chatMediaReady } from "@/lib/chat-schema";
import { MEDIA_BUCKET } from "@/lib/media";
import type { ChatMessage } from "@/lib/types";

const bodySchema = z.object({
  content: z.string().trim().min(1).max(2000, "Message is too long"),
});

/**
 * Edit one of your own messages.
 *
 * Direct edits through RLS are blocked by the guard trigger in migration
 * 0006, so this route is the only writer of message text after posting. It
 * always runs Python moderation on the new text first, exactly like the post
 * route: an edit must not become a way to smuggle in words that would have
 * been blocked at post time.
 *
 * The response re-selects with the shared `MESSAGE_COLUMNS`, attachments
 * included, because the client replaces its whole row with this object. A
 * narrower projection would silently strip the photo off a message whose
 * caption was just edited. On a database that has not taken 0009 the embed is
 * left off, since asking for it there is an error and the edit would fail.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Unknown message" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message" },
      { status: 400 },
    );
  }

  const { content } = parsed.data;

  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!profile.onboarding_done) {
    return NextResponse.json({ error: "Finish setup first" }, { status: 403 });
  }

  // The user-scoped client is enough here: RLS only exposes visible messages,
  // so a soft-deleted one comes back as "not found" without a special case.
  const supabase = await createClient();
  const mediaReady = await chatMediaReady();
  const { data: existing } = await supabase
    .from("chat_messages")
    .select(mediaReady ? MESSAGE_COLUMNS : MESSAGE_COLUMNS_BASE)
    .eq("id", id)
    .single<ChatMessage>();

  if (!existing) {
    return NextResponse.json({ error: "Unknown message" }, { status: 404 });
  }
  if (existing.user_id !== profile.id) {
    return NextResponse.json({ error: "Not your message" }, { status: 403 });
  }

  // A no-op edit should not mark the message as edited or burn a moderation
  // call. The row is already known to be visible to this member.
  if (existing.content === content) {
    return NextResponse.json({ ok: true, message: existing });
  }

  const verdict = await moderateMessage(content, {
    userId: profile.id,
    roomId: existing.room_id,
    preferenceType: profile.preference_type,
  });

  if (verdict === null) {
    await logModeration({
      userId: profile.id,
      roomId: existing.room_id,
      messageId: existing.id,
      content,
      status: "blocked",
      severity: "warning",
      categories: ["service_unavailable"],
      reason: "Moderation service unreachable",
    });

    return NextResponse.json(
      {
        error:
          "We could not check your edit right now. Please try again in a moment.",
        decision: "block",
      },
      { status: 503 },
    );
  }

  if (verdict.decision === "block") {
    await logModeration({
      userId: profile.id,
      roomId: existing.room_id,
      messageId: existing.id,
      content,
      status: "blocked",
      severity: verdict.severity,
      categories: verdict.categories,
      matchedTerms: verdict.matched_terms,
      reason: verdict.reason,
      latencyMs: verdict.latency_ms,
      requestId: verdict.request_id,
    });

    return NextResponse.json(
      {
        error: "That message cannot be posted.",
        reason: verdict.reason,
        categories: verdict.categories,
        decision: "block",
      },
      { status: 422 },
    );
  }

  // Service role again: the guard trigger only lets content changes through
  // for service_role or staff, and this is the audited place for them.
  const admin = await createServiceRoleClient();
  const { data: message, error: updateError } = await admin
    .from("chat_messages")
    .update({
      content,
      edited_at: new Date().toISOString(),
      is_flagged_by_ai: verdict.decision === "flag",
      moderation_status: verdict.decision === "flag" ? "flagged" : "allowed",
    })
    .eq("id", id)
    .eq("user_id", profile.id)
    .select(mediaReady ? MESSAGE_COLUMNS : MESSAGE_COLUMNS_BASE)
    .single<ChatMessage>();

  if (updateError) {
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }

  await logModeration({
    userId: profile.id,
    roomId: existing.room_id,
    messageId: message.id,
    content,
    status: verdict.decision === "flag" ? "flagged" : "allowed",
    severity: verdict.severity,
    categories: verdict.categories,
    matchedTerms: verdict.matched_terms,
    latencyMs: verdict.latency_ms,
    requestId: verdict.request_id,
  });

  return NextResponse.json({ ok: true, message });
}

/**
 * Hide a message: the author removes their own, staff remove anyone's.
 *
 * The live database rejects member writes to chat_messages outright, so this
 * route is the only writer, same as the edit above. Authorization happens here
 * against the row read with the service role, and the row is only stamped:
 * `deleted_at` takes it out of `chat_read` for everyone while keeping the
 * moderation log entry and the anchor any reply points at.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Unknown message" }, { status: 404 });
  }

  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!profile.onboarding_done) {
    return NextResponse.json({ error: "Finish setup first" }, { status: 403 });
  }

  // The read goes through the service role so an already-deleted row still
  // comes back and gets an idempotent answer instead of a bogus 404, and so a
  // staff removal of someone else's message can be authorized before it runs.
  const admin = await createServiceRoleClient();
  const { data: existing } = await admin
    .from("chat_messages")
    .select("id, user_id, deleted_at")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Unknown message" }, { status: 404 });
  }

  const isOwner = existing.user_id === profile.id;
  const isStaff = profile.role === "admin" || profile.role === "moderator";

  if (!isOwner && !isStaff) {
    return NextResponse.json({ error: "Not your message" }, { status: 403 });
  }
  if (existing.deleted_at) {
    return NextResponse.json({ ok: true });
  }

  // No user_id filter: for a staff removal the row belongs to somebody else,
  // and re-checking it here would make the update match zero rows while still
  // answering as a success.
  const { error: deleteError } = await admin
    .from("chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);

  if (deleteError) {
    return NextResponse.json(
      { error: "Could not delete that" },
      { status: 500 },
    );
  }

  // Now that the row is hidden, drop the bytes. This runs after the stamp and
  // is deliberately best-effort: the failure that matters is a message staying
  // visible with a dead file behind it, whereas an object that outlives its row
  // is unreachable -- /api/media/[id] returns 404 once the parent message is
  // gone, and no signed URL can be minted for a row RLS no longer exposes.
  await deleteMessageObjects(admin, id);

  return NextResponse.json({ ok: true });
}

/**
 * Remove the stored files behind a soft-deleted message.
 *
 * The row is kept, not cascaded, so nothing here can be done by a foreign key.
 * Staged rows are included too: a file whose caption failed to post still has
 * bytes to reclaim, and leaving those behind is how the bucket fills up with
 * files nobody can reach.
 */
async function deleteMessageObjects(
  admin: SupabaseClient,
  messageId: string,
): Promise<void> {
  const { data: attachments } = await admin
    .from("chat_message_attachments")
    .select("id, storage_path")
    .eq("message_id", messageId);

  if (!attachments || attachments.length === 0) return;

  const { error } = await admin.storage
    .from(MEDIA_BUCKET)
    .remove(attachments.map((row) => row.storage_path as string));

  // The objects are already unreachable through the app, so this is logged as
  // the cost it is rather than raised as a failure the member would see.
  if (error) {
    console.warn(
      `[media] could not remove ${attachments.length} object(s) for message ${messageId}:`,
      error.message,
    );
    return;
  }

  // The attachment rows go too. Keeping them would let a member re-read a
  // signed URL for bytes that are no longer there, and would keep the deleted
  // file in the admin dossier's attachment count.
  await admin
    .from("chat_message_attachments")
    .delete()
    .eq("message_id", messageId);
}
