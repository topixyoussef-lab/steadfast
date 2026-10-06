import { NextResponse } from "next/server";

import { getProfile } from "@/lib/dal";
import { fetchLinkPreview } from "@/lib/link-preview";

/**
 * Read a link's title, description, site name and image for the preview card.
 *
 * Signed-in only, because this is a chat feature and every request it makes
 * leaves this server: an open endpoint that fetches arbitrary addresses on
 * demand is a scanner with a JSON interface. The session check is what stops it
 * being that.
 *
 * `null` comes back as 404 rather than 200-with-nothing, so a card that failed
 * to load is distinguishable at the network level from one that has not been
 * asked for yet, and the failure is not cached by the browser as a success.
 */
export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  if (raw.length > 2048) {
    return NextResponse.json({ error: "URL is too long" }, { status: 400 });
  }

  const preview = await fetchLinkPreview(raw);
  if (!preview) {
    return NextResponse.json({ error: "No preview available" }, { status: 404 });
  }

  // The preview of a URL does not depend on who asked, so it is cacheable for
  // everyone. s-maxage is what keeps a link pasted into a busy room from
  // producing one outbound fetch per reader after the first.
  return NextResponse.json(preview, {
    headers: {
      "cache-control":
        "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
