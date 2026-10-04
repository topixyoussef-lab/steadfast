import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Appends one row to the moderation log.
 *
 * Shared by the post and edit routes: both run Python moderation first and
 * both must leave the same paper trail, or the admin console would show a
 * message as edited with no record of what it was checked against.
 */
export async function logModeration(entry: {
  userId: string;
  roomId?: string;
  messageId?: string;
  content: string;
  status: "allowed" | "flagged" | "blocked";
  severity: "info" | "warning" | "critical";
  categories: string[];
  matchedTerms?: string[];
  reason?: string;
  latencyMs?: number;
  requestId?: string;
}) {
  try {
    const admin = await createServiceRoleClient();
    await admin.from("moderation_log").insert({
      user_id: entry.userId,
      room_id: entry.roomId ?? null,
      message_id: entry.messageId ?? null,
      content_preview: entry.content.slice(0, 300),
      status: entry.status,
      severity: entry.severity,
      categories: entry.categories,
      matched_terms: entry.matchedTerms ?? [],
      latency_ms: entry.latencyMs ? Math.round(entry.latencyMs) : null,
      request_id: entry.requestId ?? null,
    });
  } catch {
    // Logging must never break the member's request.
  }
}
