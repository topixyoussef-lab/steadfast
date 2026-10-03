import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { offlinePanicResponse, requestPanicSupport } from "@/lib/python-client";

const bodySchema = z.object({
  urgeLevel: z.coerce.number().int().min(0).max(10),
  trigger: z.string().trim().max(120).optional().nullable(),
  message: z.string().trim().max(280).optional().nullable(),
});

/**
 * SOS intake.
 *
 * This endpoint never refuses to answer. If Python is unreachable we fall back
 * to static crisis copy and still record the alert, because an alert in the
 * admin queue is worth more than a tailored script.
 *
 * log_panic runs as the member (SECURITY DEFINER) and fans out notifications
 * to staff, so we never need the service_role key here.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { urgeLevel, trigger, message } = parsed.data;

  const support = await requestPanicSupport({
    urgeLevel,
    preferenceType: profile.preference_type,
    currentStreak: profile.current_streak,
    trigger: trigger ?? null,
    timezone: profile.timezone,
    message: message ?? null,
  });

  const response = support ?? offlinePanicResponse(urgeLevel);

  const supabase = await createClient();
  const { error } = await supabase.rpc("log_panic", {
    p_message: message ?? null,
    p_urge_level: urgeLevel,
    p_source: "panic_button",
    p_ai_response: response.response,
    p_ai_response_ms: Math.round(response.latency_ms),
    p_response_cache_key: response.cache_key,
  });

  if (error) {
    // The member still gets their support. A missed alert is the lesser
    // failure, so we surface it to staff rather than to the user.
    console.error("log_panic failed", error.message);
  }

  return NextResponse.json({ ok: true, support: response, degraded: support === null });
}