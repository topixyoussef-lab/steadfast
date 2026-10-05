"use client";

import { useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";
import { formatBytes, formatDuration } from "@/lib/media";
import type { ChatAttachment } from "@/lib/types";

/**
 * Rendering one posted file.
 *
 * Every src here is /api/media/<id>, never a storage path. That route checks the
 * viewer can read the message carrying the file and then redirects to a
 * short-lived signed URL, so a URL pasted out of this component is a link that
 * stops working on its own and reveals nothing to somebody who was not already
 * able to see it.
 *
 * Two decisions worth naming:
 *
 *  - Audio has no native controls. The WebView this ships in renders
 *    `<audio controls>` inconsistently, so there is an explicit play button and a
 *    progress bar, which also gives the member a single obvious tap target.
 *  - Video is muted by default with the poster being its own first frame, because
 *    a clip that starts making noise on scroll in a recovery room is not a
 *    neutral default.
 */

function mediaSrc(attachment: ChatAttachment) {
  return `/api/media/${attachment.id}`;
}

export function AttachmentView({
  attachment,
  mine,
}: {
  attachment: ChatAttachment;
  mine: boolean;
}) {
  if (attachment.kind === "image") {
    return <ImageAttachment attachment={attachment} mine={mine} />;
  }
  if (attachment.kind === "video") {
    return <VideoAttachment attachment={attachment} />;
  }
  return <AudioAttachment attachment={attachment} />;
}

function FlagNote({ attachment }: { attachment: ChatAttachment }) {
  const { dict } = useI18n();
  if (attachment.moderation_status !== "flagged") return null;

  return (
    <span className="text-[11px] text-warning">
      {dict.community.attachmentFlagged}
    </span>
  );
}

function ImageAttachment({
  attachment,
  mine,
}: {
  attachment: ChatAttachment;
  mine: boolean;
}) {
  const { dict } = useI18n();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-4 text-xs text-muted">
        {dict.community.attachmentUnavailable}
      </div>
    );
  }

  return (
    <figure className="flex max-w-[16rem] flex-col gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- the src is a
          signed-URL redirect from /api/media, not a static file, so next/image
          would have nothing to optimise against. */}
      <img
        src={mediaSrc(attachment)}
        alt={dict.community.attachmentImageAlt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={cn(
          "max-h-72 w-full rounded-xl object-cover",
          mine ? "bg-accent-soft" : "bg-sunken",
        )}
      />
      <figcaption className="flex items-center justify-between text-[11px] text-faint">
        <span>{formatBytes(attachment.byte_size)}</span>
        <FlagNote attachment={attachment} />
      </figcaption>
    </figure>
  );
}

function VideoAttachment({ attachment }: { attachment: ChatAttachment }) {
  const { dict } = useI18n();

  return (
    <figure className="flex max-w-[16rem] flex-col gap-1">
      <video
        src={mediaSrc(attachment)}
        controls
        // A recovery room is not the place for a clip to start talking over
        // someone else's post the moment it scrolls into view.
        muted
        playsInline
        preload="metadata"
        className="max-h-72 w-full rounded-xl bg-sunken"
      >
        {dict.community.attachmentVideoUnsupported}
      </video>
      <figcaption className="flex items-center justify-between text-[11px] text-faint">
        <span>{formatBytes(attachment.byte_size)}</span>
        <FlagNote attachment={attachment} />
      </figcaption>
    </figure>
  );
}

function AudioAttachment({ attachment }: { attachment: ChatAttachment }) {
  const { dict } = useI18n();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);

  const duration =
    attachment.duration_seconds && attachment.duration_seconds > 0
      ? attachment.duration_seconds
      : null;

  function toggle() {
    const el = document.getElementById(`audio-${attachment.id}`) as
      | HTMLAudioElement
      | null;
    if (!el) return;

    if (playing) {
      el.pause();
      return;
    }
    void el.play().catch(() => setFailed(true));
  }

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-4 text-xs text-muted">
        {dict.community.attachmentUnavailable}
      </div>
    );
  }

  return (
    <div className="flex min-w-44 max-w-64 flex-col gap-1">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? dict.community.attachmentPause : dict.community.attachmentPlay}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast transition hover:bg-accent-strong"
        >
          {playing ? (
            <PauseGlyph />
          ) : (
            <PlayGlyph />
          )}
        </button>

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            role="progressbar"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-canvas"
          >
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.min(progress * 100, 100)}%` }}
            />
          </span>
          <span className="text-[11px] text-faint">
            {formatDuration(duration)}
          </span>
        </span>
      </div>

      {/* Kept out of the layout and given no controls: playback is driven by the
          button above, because the native control set does not render reliably
          inside the WebView this app ships in. */}
      <audio
        id={`audio-${attachment.id}`}
        src={mediaSrc(attachment)}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(event) => {
          const el = event.currentTarget;
          if (el.duration && Number.isFinite(el.duration)) {
            setProgress(el.currentTime / el.duration);
          }
        }}
        onError={() => setFailed(true)}
      />

      {attachment.description ? (
        <p className="line-clamp-2 text-[11px] text-faint" title={attachment.description}>
          {dict.community.attachmentTranscript}: {attachment.description}
        </p>
      ) : null}

      <FlagNote attachment={attachment} />
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="ms-0.5 h-4 w-4 fill-current" aria-hidden>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
    </svg>
  );
}

/**
 * The staged files waiting to be sent, shown above the composer.
 *
 * They already exist in storage and have already been reviewed; what is still
 * to happen is the post that references them. Saying so is the difference
 * between "uploading" and "ready to post", and it is what makes a failed send
 * recoverable rather than mysterious.
 */
export function StagedAttachmentChip({
  attachment,
  onRemove,
  busy,
}: {
  attachment: ChatAttachment;
  onRemove: () => void;
  busy: boolean;
}) {
  const { dict } = useI18n();

  const label =
    attachment.kind === "image"
      ? dict.community.attachmentImage
      : attachment.kind === "audio"
        ? dict.community.attachmentVoice
        : dict.community.attachmentVideo;

  return (
    <span className="flex items-center gap-2 rounded-xl bg-sunken px-2 py-1 text-[11px] text-muted">
      <span className="font-medium text-ink">{label}</span>
      <span>{formatBytes(attachment.byte_size)}</span>
      {formatDuration(attachment.duration_seconds) ? (
        <span>{formatDuration(attachment.duration_seconds)}</span>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        aria-label={dict.community.removeAttachment}
        className="rounded-md px-1.5 text-muted transition hover:text-danger disabled:opacity-40"
      >
        ×
      </button>
    </span>
  );
}
