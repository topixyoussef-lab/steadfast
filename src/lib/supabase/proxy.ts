import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

export async function refreshSession(
  request: NextRequest,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return { response, user: null };
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Deletions are dropped, and that is the whole point of this adapter.
        //
        // Opening the app fires a burst of parallel requests (every nav link is
        // prefetched), and each one lands here with the same access token. When
        // that token is expired they all call the refresh endpoint with the same
        // refresh token; GoTrue rotates it, so exactly one wins and the losers
        // come back as a missing-session error, which GoTrueClient answers with
        // _removeSession(). Forwarding that removal to the browser deletes the
        // cookie the winner just wrote, and the member is signed out by a
        // request they never made. Keeping only real writes means a lost race
        // costs nothing: the winner's cookie stands.
        //
        // Signing out still clears cookies, because it goes through a Server
        // Action (src/lib/supabase/server.ts), not the proxy.
        const writes = cookiesToSet.filter(
          ({ value, options }) => value !== "" && (options.maxAge ?? 1) > 0,
        );
        if (writes.length === 0) return;

        for (const { name, value } of writes) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of writes) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Must be getUser(), not getSession(): it revalidates the JWT with Supabase
  // Auth on the server. getSession() trusts cookie contents alone.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
