import { NextResponse } from "next/server";
import { z } from "zod";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolveBindCode } from "@/lib/watch-bind";

const eventSchema = z.object({
  domain: z.string().trim().min(1).max(255),
  blocked: z.boolean().optional(),
  at: z.string().datetime().optional(),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(500),
});

/**
 * Ingestion endpoint for the Steadfast Watch companions.
 *
 * Two callers are accepted:
 *   * a normal member session token (Bearer) - the Android / Windows guards;
 *   * a signed parent-issued bind code (X-Watch-Bind) - the browser extension,
 *     which then needs no member password at all.
 * In both cases the caller is pinned to a user id BEFORE the RPC runs, and
 * watch_ingest refuses to write anything for a user whose consent is not
 * currently active (0011). A revoked agreement drains the pipeline even if a
 * stale companion keeps reporting.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const admin = await createServiceRoleClient();

  // Preferred: a signed parent-issued bind code (see lib/watch-bind). It still
  // has to satisfy the member's own active consent inside watch_ingest.
  const bindHeader = request.headers.get("x-watch-bind");
  let userId: string | null = null;
  if (bindHeader) {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    userId = secret ? resolveBindCode(bindHeader, secret) : null;
    if (!userId) {
      return NextResponse.json({ error: "Invalid bind code" }, { status: 401 });
    }
  } else {
    const authorization = request.headers.get("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : null;

    if (!token) {
      return NextResponse.json({ error: "Missing session" }, { status: 401 });
    }

    const { data: session, error: authError } = await admin.auth.getUser(token);
    if (authError || !session?.user?.id) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    userId = session.user.id;
  }

  const { data: imported, error } = await admin.rpc("watch_ingest", {
    p_events: parsed.data.events,
    p_user_id: userId,
  });

  if (error) {
    // 42501 = no active consent. The device should see this and stop nagging.
    return NextResponse.json(
      { error: error.message },
      { status: error.code === "42501" ? 403 : 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    imported: typeof imported === "number" ? imported : 0,
  });
}