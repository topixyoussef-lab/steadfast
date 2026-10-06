import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createBindCode } from "@/lib/watch-bind";

/**
 * Issues a signed device bind for a consented member.
 *
 * Staff only. The code resolves on /api/watch to the chosen member's user id
 * while their consent stays active; when protection is off the ingest keeps
 * refusing exactly as for any other companion. The code lives 7 days and is
 * shown once in the console.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (
    !profile ||
    (profile.role !== "admin" && profile.role !== "moderator")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { memberId?: unknown } | null;
  const memberId = body?.memberId;
  if (typeof memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(memberId)) {
    return NextResponse.json({ error: "Invalid member" }, { status: 400 });
  }

  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }

  const { code, expiresAt } = createBindCode(memberId, secret);
  return NextResponse.json({ code, expiresAt });
}