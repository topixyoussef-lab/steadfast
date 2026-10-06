import { NextResponse } from "next/server";
import { z } from "zod";

import { createServiceRoleClient } from "@/lib/supabase/server";

const eventSchema = z.object({
  domain: z.string().trim().min(1).max(255),
  blocked: z.boolean().optional(),
  at: z.string().datetime().optional(),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(500),
});

/**
 * Ingestion endpoint for the device companion.
 *
 * The caller sends a normal member session token, so the service_role key is
 * never in the app. The token is verified server-side and pinned to a user id
 * BEFORE the RPC runs; watch_ingest then refuses to write anything for a user
 * whose consent is not currently active (0011). A revoked agreement drains
 * the pipeline even if a stale device keeps reporting.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    return NextResponse.json({ error: "Missing session" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const admin = await createServiceRoleClient();
  const { data: session, error: authError } = await admin.auth.getUser(token);
  if (authError || !session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: imported, error } = await admin.rpc("watch_ingest", {
    p_events: parsed.data.events,
    p_user_id: session.user.id,
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