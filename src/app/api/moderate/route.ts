import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { moderateMessage } from "@/lib/python-client";
import { logModeration } from "@/lib/moderation-log";

const bodySchema = z.object({
  roomId: z.string().uuid("Unknown room"),
  content: z.string().trim().min(1).max(2000, "Message is too long"),
  replyTo: z.string().uuid().optional().nullable(),
});

/**
 * The only writer of chat_messages.
 *
 * There is deliberately no client-side INSERT policy on chat_messages, so
 * this handler is the sole path a message can take into the database, and it
 * always runs Python moderation first. Blocked messages are logged and
 * dropped; they are never stored.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message" },
      { status: 400 },
    );
  }

  const { roomId, content, replyTo } = parsed.data;

  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!profile.onboarding_done) {
    return NextResponse.json({ error: "Finish setup first" }, { status: 403 });
  }

  // Confirm the room exists and is visible to this member before spending a
  // moderation call on it.
  const supabase = await createClient();
  const { data: room } = await supabase
    .from("rooms")
    .select("id, is_private")
    .eq("id", roomId)
    .single();

  if (!room) {
    return NextResponse.json({ error: "Unknown room" }, { status: 404 });
  }
  if (room.is_private && profile.role === "user") {
    return NextResponse.json({ error: "Unknown room" }, { status: 404 });
  }

  const verdict = await moderateMessage(content, {
    userId: profile.id,
    roomId,
    preferenceType: profile.preference_type,
  });

  if (verdict === null) {
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

  if (verdict.decision === "block") {
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
      is_flagged_by_ai: verdict.decision === "flag",
      moderation_status: verdict.decision === "flag" ? "flagged" : "allowed",
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

  await logModeration({
    userId: profile.id,
    roomId,
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