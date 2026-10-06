import { NextResponse } from "next/server";
import { z } from "zod";

import { createServiceRoleClient, createClient } from "@/lib/supabase/server";
import { chatMediaReady } from "@/lib/chat-schema";
import { getProfile } from "@/lib/dal";
import { moderateMedia } from "@/lib/python-client";
import { logModeration } from "@/lib/moderation-log";
import {
  accepts,
  extensionFor,
  KIND_LIMITS,
  MAX_MEDIA_BYTES,
  MEDIA_BUCKET,
} from "@/lib/media";
import type { AttachmentKind } from "@/lib/types";

/**
 * Uploading an attachment.
 *
 * This route, and only this route, writes to the `chat-media` bucket and inserts
 * a row into chat_message_attachments. Neither the bucket nor the table grants
 * anything to the anon or authenticated roles, so a browser holding the
 * publishable key cannot put a file in storage or make it addressable.
 *
 * The order matters and is not negotiable:
 *
 *   1. the member and the room are checked, including the room's switches;
 *   2. the bytes are validated against the closed accept list;
 *   3. the moderation service looks at the bytes -- not at a filename, not at
 *      the caption;
 *   4. only then is anything written anywhere.
 *
 * A blocked attachment is never stored, and an unreviewable one is refused
 * outright: the moderation service has no fallback for media, so a null verdict
 * means no answer, and an unanswered question about a photograph is answered
 * "no".
 */

export const maxDuration = 60;

/**
 * The room row this route reads, before and after 0009.
 *
 * The select is a ternary of two literal strings and supabase-js cannot infer a
 * row from a union of them -- it falls back to its ParserError marker, which
 * makes every field untypeable. The three switches are therefore optional: they
 * are in the select only once 0009 has landed, and the `!mediaReady` refusal
 * below runs before anything reads one.
 */
type RoomMediaAccess = {
  id: string;
  is_private: boolean;
  chat_locked?: boolean;
  voice_enabled?: boolean;
  media_enabled?: boolean;
};

const querySchema = z.object({
  roomId: z.string().uuid("Unknown room"),
  kind: z.enum(["image", "audio", "video"]),
  // Optional. A caption gives the model context; it does not replace the model
  // looking at the attachment.
  caption: z.string().max(2000).optional(),
  // Reported by the recorder, not measured from the file. It is display-only:
  // nothing about the moderation decision depends on it.
  duration: z.coerce.number().min(0).max(600).optional(),
});

/** Sniff the declared type against the magic bytes, so a renamed file cannot lie. */
function declaredTypeMatchesBytes(
  kind: AttachmentKind,
  mimeType: string,
  bytes: Uint8Array,
): boolean {
  const startsWith = (...bytes_: number[]) =>
    bytes.length >= bytes_.length && bytes_.every((b, i) => bytes[i] === b);

  if (kind === "image") {
    if (mimeType === "image/jpeg") return startsWith(0xff, 0xd8, 0xff);
    if (mimeType === "image/png") {
      return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    }
    if (mimeType === "image/webp") {
      return (
        startsWith(0x52, 0x49, 0x46, 0x46) &&
        bytes.length >= 12 &&
        bytes[8] === 0x57 && // W
        bytes[9] === 0x45 && // E
        bytes[10] === 0x42 && // B
        bytes[11] === 0x50 // P
      );
    }
    return false;
  }

  if (kind === "audio") {
    if (mimeType === "audio/webm") {
      // Matroska: EBML header. The DocType further in is what distinguishes webm
      // from mkv, and both are equally unreviewable-by-luck, so the container
      // check is enough.
      return startsWith(0x1a, 0x45, 0xdf, 0xa3);
    }
    if (mimeType === "audio/ogg") return startsWith(0x4f, 0x67, 0x67, 0x53);
    if (mimeType === "audio/mpeg") {
      // Two ways an MPEG audio file starts. An ID3v2 tag is what every encoder
      // writes by default, but a tagless stream begins straight on its first
      // frame, and accepting only ID3 would refuse a perfectly ordinary
      // recording from a phone that was told to skip tags.
      if (startsWith(0x49, 0x44, 0x33)) return true;
      if (bytes.length >= 2 && bytes[0] === 0xff) {
        // 11 sync bits, then a layer and bitrate that are not the reserved
        // encodings. Checking the layer matters: 0b00 is "reserved", so an
        // all-ones header would otherwise pass as audio.
        return (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0x00;
      }
      return false;
    }
    if (mimeType === "audio/mp4") {
      // ftyp box: 4 size, "ftyp", then the brand.
      return (
        bytes.length >= 12 &&
        bytes[4] === 0x66 &&
        bytes[5] === 0x74 &&
        bytes[6] === 0x79 &&
        bytes[7] === 0x70
      );
    }
    return false;
  }

  if (mimeType === "video/mp4") {
    return (
      bytes.length >= 12 &&
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70
    );
  }
  if (mimeType === "video/webm") return startsWith(0x1a, 0x45, 0xdf, 0xa3);
  return false;
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  const parsedQuery = querySchema.safeParse({
    roomId: url.searchParams.get("roomId"),
    kind: url.searchParams.get("kind"),
    caption: url.searchParams.get("caption") ?? undefined,
    duration: url.searchParams.get("duration") ?? undefined,
  });

  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: parsedQuery.error.issues[0]?.message ?? "Invalid upload" },
      { status: 400 },
    );
  }

  const { roomId, kind, caption, duration } = parsedQuery.data;

  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!profile.onboarding_done) {
    return NextResponse.json({ error: "Finish setup first" }, { status: 403 });
  }

  // The room decides whether this member may post at all, and then whether this
  // particular channel is open. Both switches are re-read here rather than
  // trusted from the client, because a hidden button is not a lock.
  //
  // The switches are 0009 columns and naming one that is absent is a PostgREST
  // error rather than a null, which would make this look like an unknown room.
  // Without 0009 there is also nowhere to stage the file into, so the room check
  // runs on the columns that have always existed and the upload is then refused
  // explicitly instead of failing somewhere in the middle.
  const mediaReady = await chatMediaReady();
  const supabase = await createClient();
  const { data: room } = await supabase
    .from("rooms")
    .select(
      mediaReady
        ? "id, is_private, chat_locked, voice_enabled, media_enabled"
        : "id, is_private",
    )
    .eq("id", roomId)
    .single<RoomMediaAccess>();

  if (!room) {
    return NextResponse.json({ error: "Unknown room" }, { status: 404 });
  }
  if (room.is_private && profile.role === "user") {
    return NextResponse.json({ error: "Unknown room" }, { status: 404 });
  }
  if (!mediaReady) {
    return NextResponse.json(
      {
        error:
          "Media is unavailable until migration 0009 has been applied to the database.",
      },
      { status: 503 },
    );
  }
  if (room.chat_locked) {
    return NextResponse.json(
      { error: "This room is closed to new messages.", locked: true },
      { status: 403 },
    );
  }
  if (kind === "audio" && !room.voice_enabled) {
    return NextResponse.json(
      { error: "Voice notes are off in this room.", locked: true },
      { status: 403 },
    );
  }
  if (kind !== "audio" && !room.media_enabled) {
    return NextResponse.json(
      { error: "Photos and videos are off in this room.", locked: true },
      { status: 403 },
    );
  }

  let bytes: ArrayBuffer;
  let mimeType: string;
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was sent" }, { status: 400 });
    }

    mimeType = file.type.toLowerCase();

    // The allowlist is decided by kind, so an "audio" upload cannot smuggle in
    // a type that happens to also be an accepted image.
    if (!accepts(kind, mimeType)) {
      return NextResponse.json(
        { error: `That file type cannot be sent as ${kind}.` },
        { status: 415 },
      );
    }

    if (file.size > KIND_LIMITS[kind] || file.size > MAX_MEDIA_BYTES) {
      return NextResponse.json(
        { error: "That file is too large." },
        { status: 413 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "That file is empty." }, { status: 400 });
    }

    bytes = await file.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "Could not read that file" }, { status: 400 });
  }

  // A Content-Type header is client-supplied. The magic-byte check is not.
  if (!declaredTypeMatchesBytes(kind, mimeType, new Uint8Array(bytes))) {
    return NextResponse.json(
      { error: "That file is not the kind of media it claims to be." },
      { status: 415 },
    );
  }

  const verdict = await moderateMedia(bytes, { kind, mimeType, caption });

  if (verdict === null) {
    // No verdict is not a pass. There is no lexicon behind this call, so there is
    // nothing to fall back to and the only honest answer is to refuse.
    await logModeration({
      userId: profile.id,
      roomId,
      content: caption ?? "",
      status: "blocked",
      severity: "warning",
      categories: ["service_unavailable"],
      reason: `Could not review ${kind} before posting`,
    });

    return NextResponse.json(
      {
        error:
          "We could not check your file right now. Please try again in a moment.",
        decision: "block",
      },
      { status: 503 },
    );
  }

  if (verdict.decision === "block") {
    // Nothing is written on this path. Not the bytes, not the row, not the
    // preview: a blocked attachment has to leave no trace a reader could find.
    await logModeration({
      userId: profile.id,
      roomId,
      content: verdict.transcript || verdict.description || caption || "",
      status: "blocked",
      severity: verdict.severity,
      categories: verdict.categories,
      reason: verdict.reason,
      latencyMs: verdict.latency_ms,
      requestId: verdict.request_id,
    });

    return NextResponse.json(
      {
        error: "That file cannot be posted.",
        reason: verdict.reason,
        categories: verdict.categories,
        decision: "block",
      },
      { status: 422 },
    );
  }

  // Reviewed and permitted. Now, and only now, does a byte reach storage.
  const admin = await createServiceRoleClient();
  const storagePath = `${profile.id}/${crypto.randomUUID()}.${extensionFor(mimeType)}`;

  const { error: uploadError } = await admin.storage
    .from(MEDIA_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });

  if (uploadError) {
    return NextResponse.json(
      { error: "Could not save that file" },
      { status: 500 },
    );
  }

  // Staged: message_id stays null and only this uploader can see the row. It is
  // claimed by /api/moderate when the message that references it is written.
  const { data: attachment, error: insertError } = await admin
    .from("chat_message_attachments")
    .insert({
      user_id: profile.id,
      kind,
      storage_path: storagePath,
      mime_type: mimeType,
      byte_size: bytes.byteLength,
      // The model's own words, kept so a moderator can review without opening
      // the file, and so the log keeps a preview of a post that had no text.
      description: verdict.transcript || verdict.description || null,
      duration_seconds: kind === "audio" ? (duration ?? null) : null,
      moderation_status: verdict.decision === "flag" ? "flagged" : "allowed",
    })
    .select("id, message_id, user_id, kind, mime_type, byte_size, description, duration_seconds, moderation_status, created_at")
    .single();

  if (insertError || !attachment) {
    // The object exists with no row pointing at it and no way to reach it: the
    // bucket is private and only the uploader could have listed it, and the uploader
    // has no row. Leaving it is a cost, not a leak; note it and fail the request.
    await admin.storage.from(MEDIA_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: "Could not save that file" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, attachment });
}
