import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { chatMediaReady } from "@/lib/chat-schema";
import { getProfile } from "@/lib/dal";
import { moderateMessage } from "@/lib/python-client";
import { logModeration } from "@/lib/moderation-log";
import type { ChatAttachment } from "@/lib/types";

const bodySchema = z.object({
  roomId: z.string().uuid("Unknown room"),
  // May be empty: 0009 relaxed the column CHECK so a photo or a voice note can
  // stand on its own. "At least a caption or an attachment" is enforced below.
  content: z.string().trim().max(2000, "Message is too long"),
  replyTo: z.string().uuid().optional().nullable(),
  // Staged attachment ids from /api/media/upload. Bounded to four files a
  // message, which is a ceiling on what one bubble can hold rather than a
  // per-room quota.
  attachments: z.array(z.string().uuid()).max(4).optional(),
});

/**
 * The room row this route reads, before and after 0009.
 *
 * The select is a ternary of two literal strings and supabase-js cannot infer a
 * row from a union of them -- it falls back to its ParserError marker, so
 * `room.chat_locked` would not typecheck at all. Naming the shape is also what
 * keeps the optional column honest: `chat_locked` is only in the select once
 * 0009 has landed, hence optional here, and hence every read of it is guarded by
 * `mediaReady`.
 */
type RoomAccess = {
  id: string;
  is_private: boolean;
  chat_locked?: boolean;
};

/**
 * The only writer of chat_messages.
 *
 * There is deliberately no client-side INSERT policy on chat_messages, so this
 * handler is the sole path a message can take into the database, and it always
 * runs Python moderation first. Blocked messages are logged and dropped; they
 * are never stored.
 *
 * Attachments arrive here already reviewed. /api/media/upload put each file
 * through the moderation service before writing a single byte, and left it in a
 * staged row that only its uploader can see. This route's second job is to
 * claim those rows onto the message being written, and it does so through
 * `claim_message_attachments`, which counts what it attached and raises if that
 * count does not match what was asked for -- so a member cannot attach somebody
 * else's staged file, or the same file twice, by sending ids that were not
 * theirs.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message" },
      { status: 400 },
    );
  }

  const { roomId, content, replyTo, attachments } = parsed.data;
  const attachmentIds = attachments ?? [];

  if (!content && attachmentIds.length === 0) {
    return NextResponse.json(
      { error: "Write something or add a file" },
      { status: 400 },
    );
  }

  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!profile.onboarding_done) {
    return NextResponse.json({ error: "Finish setup first" }, { status: 403 });
  }

  // Confirm the room exists and is visible to this member before spending a
  // moderation call on it.
  //
  // chat_locked is a 0009 column. Asking for it when the column is not there is
  // a PostgREST error, not a null, so `room` would come back null and every
  // single text message would be refused as "Unknown room" on a database the
  // migration has not reached yet. The room check and the lock check therefore
  // follow the same probe the pages do, and a database without the lock column
  // reads as an open room -- the way every room read before 0009 existed.
  const mediaReady = await chatMediaReady();
  const supabase = await createClient();
  const { data: room } = await supabase
    .from("rooms")
    .select(mediaReady ? "id, is_private, chat_locked" : "id, is_private")
    .eq("id", roomId)
    .single<RoomAccess>();

  if (!room) {
    return NextResponse.json({ error: "Unknown room" }, { status: 404 });
  }
  if (room.is_private && profile.role === "user") {
    return NextResponse.json({ error: "Unknown room" }, { status: 404 });
  }
  // A closed room is closed to staff as well. Reading it is still allowed; the
  // composer is replaced by a notice rather than disabled, so the room reads as
  // deliberately closed instead of broken.
  if (mediaReady && room.chat_locked) {
    return NextResponse.json(
      { error: "This room is closed to new messages.", locked: true },
      { status: 403 },
    );
  }

  // No caption means no text to score. Each file was already scored on its own
  // upload, so there is nothing left for the text pass to do and skipping it
  // avoids spending a moderation call on an empty string.
  const verdict = content
    ? await moderateMessage(content, {
        userId: profile.id,
        roomId,
        preferenceType: profile.preference_type,
      })
    : null;

  if (verdict === null && content) {
    // Fail closed. The moderation log records why, so staff can see whether
    // this is a member being blocked by an outage or by their own words.
    await logModeration({
      userId: profile.id,
      roomId,
      content,
      status: "blocked",
      severity: "warning",
      categories: ["service_unavailable"],
      reason: "Moderation service unreachable",
    });

    return NextResponse.json(
      {
        error:
          "We could not check your message right now. Please try again in a moment.",
        decision: "block",
      },
      { status: 503 },
    );
  }

  if (verdict?.decision === "block") {
    await logModeration({
      userId: profile.id,
      roomId,
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

  const flagged = verdict?.decision === "flag";

  // service_role bypasses RLS on purpose. This is the one place the server
  // speaks to the table with elevated rights.
  const admin = await createServiceRoleClient();
  const { data: message, error: insertError } = await admin
    .from("chat_messages")
    .insert({
      room_id: roomId,
      user_id: profile.id,
      content,
      reply_to: replyTo ?? null,
      is_flagged_by_ai: flagged,
      moderation_status: flagged ? "flagged" : "allowed",
    })
    // The full row, not a hand-picked subset: the composer hands this
    // straight to the thread as the optimistic message, so a partial row
    // would render the sender's own message as someone else's bubble.
    .select(
      "id, room_id, user_id, content, is_flagged_by_ai, moderation_status, reply_to, created_at, edited_at, deleted_at",
    )
    .single();

  if (insertError) {
    return NextResponse.json({ error: "Could not save that" }, { status: 500 });
  }

  // Claim after the message exists, because the row needs its id.
  const claimed = await claimAttachments({
    messageId: message.id,
    attachmentIds,
    userId: profile.id,
  });

  if (claimed === null) {
    // The caption is already posted, so this is not a failure to hide from the
    // member: it goes in the log and the message simply went up without the
    // file. The staged rows stay staged and unreachable by anyone else.
    await logModeration({
      userId: profile.id,
      roomId,
      messageId: message.id,
      content,
      status: "allowed",
      severity: "info",
      categories: ["attachment_claim_failed"],
      reason: "An attachment could not be attached to the message",
    });
  }

  await logModeration({
    userId: profile.id,
    roomId,
    messageId: message.id,
    content,
    status: flagged ? "flagged" : "allowed",
    severity: verdict?.severity ?? "info",
    categories: verdict?.categories ?? [],
    matchedTerms: verdict?.matched_terms,
    latencyMs: verdict?.latency_ms,
    requestId: verdict?.request_id,
  });

  return NextResponse.json({
    ok: true,
    message: { ...message, attachments: claimed ?? [] },
  });
}

/**
 * Attach staged rows to the message just written.
 *
 * Returns the claimed rows, or null when the claim was refused. Every refusal
 * case is "an id was not yours, or was already used", which the function detects
 * by counting rather than by trusting the caller.
 */
async function claimAttachments(input: {
  messageId: string;
  attachmentIds: string[];
  userId: string;
}): Promise<ChatAttachment[] | null> {
  if (input.attachmentIds.length === 0) return [];

  const admin = await createServiceRoleClient();
  const { data, error } = await admin.rpc("claim_message_attachments", {
    p_message_id: input.messageId,
    p_attachment_ids: input.attachmentIds,
    p_user_id: input.userId,
  });

  if (error) return null;

  // Picked field by field rather than "everything except storage_path": a
  // storage path is not something to hand a browser, and an allowlist cannot
  // start leaking the next time the function's return type grows a column.
  // The file itself is reachable through /api/media/[id].
  return ((data ?? []) as (ChatAttachment & { storage_path?: string })[]).map(
    (row) => ({
      id: row.id,
      message_id: row.message_id,
      user_id: row.user_id,
      kind: row.kind,
      mime_type: row.mime_type,
      byte_size: row.byte_size,
      description: row.description,
      duration_seconds: row.duration_seconds,
      moderation_status: row.moderation_status,
      created_at: row.created_at,
    }),
  );
}
