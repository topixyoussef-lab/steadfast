import "server-only";

import { cache } from "react";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Memoised per request: the data layer calls this four or five times to render
 * one page (profile, tasks, notifications, staff ids), and each call used to
 * build a fresh GoTrueClient. Only one instance at a time can single-flight a
 * token refresh, so a page render fired that many independent refreshes with
 * the same refresh token — GoTrue rotates it, so all but one came back as a
 * missing session. Sharing the client lets the library's own dedupe do its job.
 */
export const createClient = cache(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Safe to ignore: the proxy refreshes the session on the next request.
        }
      },
    },
  });
});

export async function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local.",
    );
  }

  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
