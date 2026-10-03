import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Dev-only one-click login.
 *
 * Mints a session for the seeded operator account so local work does not
 * depend on typing a password into a browser that may have a password manager
 * rewriting the field. Refuses to run in production, and only ever signs in the
 * one address in DEV_LOGIN_EMAIL.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const email = process.env.DEV_LOGIN_EMAIL;
  if (!email) {
    return new NextResponse("Not found", { status: 404 });
  }

  const admin = await createServiceRoleClient();
  const { data: link, error: linkError } =
    await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError || !link.properties.hashed_token) {
    return new NextResponse(linkError?.message ?? "no token", { status: 500 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
  const cookieStore = await cookies();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_done")
    .eq("email", email)
    .maybeSingle();

  // Same origin the request arrived on, so it works on any host or port.
  const target = profile?.onboarding_done ? "/dashboard" : "/onboarding";
  return NextResponse.redirect(new URL(target, request.url));
}