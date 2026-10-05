import { NextResponse } from "next/server";

/**
 * Reports the stamp of the build that is currently deployed.
 *
 * A client compares it against the stamp baked into its own bundle; a mismatch
 * means a newer build went live while the page was open. `no-store` matters:
 * this answer has to come from the running deployment, so neither Vercel's edge
 * cache nor the browser may hold onto it.
 */
export async function GET() {
  return NextResponse.json(
    { stamp: process.env.NEXT_PUBLIC_BUILD_STAMP ?? "unknown" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
