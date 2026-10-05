/**
 * What an attachment is allowed to be.
 *
 * This module is the single source of truth for the accept list, the size
 * ceilings, and the human-readable copy about them. It is imported by the
 * browser (so the picker can refuse before an upload starts), by the upload
 * route (which re-checks every one of these, because a browser check is a
 * convenience and not a control), and by the renderer.
 *
 * The list is deliberately closed rather than pattern-based. "Does the MIME
 * type start with image/" would accept image/svg+xml, which is a document that
 * can carry script, and it would accept whatever a browser decides to call an
 * image. Every entry here is a format with no scripting surface.
 */

import type { AttachmentKind } from "@/lib/types";

/**
 * The private bucket created in 0009. Exported rather than spelled out at each
 * call site: a typo in a bucket name does not throw, it writes somewhere nobody
 * will ever read, so the failure is silent and the file is simply lost.
 */
export const MEDIA_BUCKET = "chat-media";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 4 * 1024 * 1024;

/** The bucket's own limit in 0009. Nothing may exceed it. */
export const MAX_MEDIA_BYTES = MAX_VIDEO_BYTES;

export const KIND_LIMITS: Record<AttachmentKind, number> = {
  image: MAX_IMAGE_BYTES,
  audio: MAX_AUDIO_BYTES,
  video: MAX_VIDEO_BYTES,
};

/**
 * image/svg+xml is absent on purpose and so is anything with a `+xml` suffix.
 */
const ACCEPTED: Record<AttachmentKind, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  audio: ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"],
  video: ["video/mp4", "video/webm"],
};

/** Extensions we are willing to write to storage, for each accepted MIME type. */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export function kindsFor(mimeType: string): AttachmentKind[] {
  const mime = mimeType.toLowerCase();
  return (Object.keys(ACCEPTED) as AttachmentKind[]).filter((kind) =>
    ACCEPTED[kind].includes(mime),
  );
}

export function accepts(kind: AttachmentKind, mimeType: string): boolean {
  return ACCEPTED[kind].includes(mimeType.toLowerCase());
}

export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType.toLowerCase()] ?? "bin";
}

/**
 * The `accept` attribute for a file input.
 *
 * Extensions as well as MIME types, because Android's file picker matches on
 * the extension in a way that a bare MIME list is unreliable against, and this
 * is the app people record voice notes on.
 */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
export const VIDEO_ACCEPT = "video/mp4,video/webm,.mp4,.webm";

/**
 * Recording container preference, in order.
 *
 * Chromium and WebKit on Android both produce audio/webm;codecs=opus. Safari on
 * iOS refuses webm and will only give audio/mp4, so it is second and is used
 * when webm cannot be constructed.
 */
export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // Older WebViews throw instead of returning false.
    }
  }
  return "";
}

/**
 * Reduce whatever the recorder produced to one of our accepted audio types.
 * `audio/webm;codecs=opus` becomes `audio/webm`; a Safari recording becomes
 * `audio/mp4`; anything else is refused rather than uploaded on trust.
 */
export function normalizeRecordedAudio(recorderMime: string): string | null {
  const base = recorderMime.split(";")[0].trim().toLowerCase();
  if (ACCEPTED.audio.includes(base)) return base;
  return null;
}

/** A finished recording, on its way to /api/media/upload. */
export type RecordedClip = {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "";
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
