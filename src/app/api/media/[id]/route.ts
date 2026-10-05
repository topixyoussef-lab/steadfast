import { NextResponse } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { MEDIA_BUCKET } from "@/lib/media";

/**
 * Serving one attachment.
 *
 * The bucket is private and has no select policy for any role, so this is the
 * only way a member can ever see a posted file. The check is deliberately not
 * "is this my attachment": it reads the attachment's parent message through the
 * same room and visibility conditions `chat_read` applies, which is what keeps a
 * file from surviving a message that was deleted or a room that was closed.
 *
 * Signed URLs are short-lived, and nothing is cached: a `Cache-Control: private,
 * no-store` on the redirect stops a shared cache or a back button from holding
 * on to a URL after the reader should have lost access.
 */

/** Ten minutes. Long enough for a video to play through on a slow line. */
const SIGNED_URL_TTL_SECONDS = 600;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Read the attachment on the *user* client so its own RLS decides. A staged
  // row comes back only for the member who uploaded it; an attached row comes
  // back only if that member can read the message carrying it.
  const supabase = await createClient();
  const { data: attachment } = await supabase
    .from("chat_message_attachments")
    .select("id, storage_path, mime_type")
    .eq("id", id)
    .maybeSingle();

  if (!attachment) {
    // 404 rather than 403: whether it exists is itself information, and this
    // route is asked with ids a member could guess.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = await createServiceRoleClient();
  const { data: signed, error } = await admin.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(attachment.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The MIME type is not restated here: the signed URL serves the object with
  // the content type it was uploaded under, and a Content-Type on a 307 would
  // only describe the empty body that goes with the redirect.
  return NextResponse.redirect(signed.signedUrl, {
    status: 307,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
