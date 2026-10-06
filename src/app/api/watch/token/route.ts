import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Hands the signed-in member's real session tokens to the device companion.
 *
 * The companion signs in with the user's own account through a WebView, then
 * this same-origin endpoint (behind the session cookie) returns the tokens it
 * needs to report browsing. Nothing here exists for a logged-out browser.
 */
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  return NextResponse.json({
    token: data.session.access_token,
    refresh: data.session.refresh_token ?? null,
    expiresAt: data.session.expires_at ?? null,
  });
}