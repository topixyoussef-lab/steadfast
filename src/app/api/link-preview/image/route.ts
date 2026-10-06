import { NextResponse } from "next/server";

import { getProfile } from "@/lib/dal";
import { fetchPreviewImage } from "@/lib/link-preview";

/**
 * Serve a preview image through us instead of pointing <img> at its origin.
 *
 * Three things this buys, in order of how much they matter:
 *
 *  - the member's browser never resolves the hostname. It resolves ours, and
 *    the address is checked again on the way out here, so an image URL that
 *    passed the checks when the message was written is re-checked now rather
 *    than trusted forever;
 *  - a card on an https page can show an http image, which would otherwise be
 *    quietly dropped as mixed content;
 *  - no request carries the member's referrer to a third party.
 *
 * Nothing but image bytes leaves this route: the content type is taken from the
 * origin and then constrained to `image/*`, so a link to an endpoint that
 * answers with HTML cannot be used to smuggle markup past the same-origin
 * boundary by pointing an <img> at it.
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

  const image = await fetchPreviewImage(raw);
  if (!image) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(image.bytes), {
    status: 200,
    headers: {
      "content-type": image.contentType,
      "cache-control":
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=1209600",
      "x-content-type-options": "nosniff",
      // The bytes were just fetched from wherever the link pointed, so nothing
      // about this response should ever be reinterpreted as something else.
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
