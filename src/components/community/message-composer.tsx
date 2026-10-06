"use client";

import { useEffect, useRef, useState } from "react";

import {
  StagedAttachmentChip,
} from "@/components/community/attachment-view";
import {
  MicGlyph,
  VoiceRecorder,
} from "@/components/community/voice-recorder";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";
import {
  IMAGE_ACCEPT,
  KIND_LIMITS,
  VIDEO_ACCEPT,
  accepts,
  formatBytes,
  type RecordedClip,
} from "@/lib/media";
import type { AttachmentKind, ChatAttachment, ChatMessage } from "@/lib/types";

const MAX = 2000;
const EDIT_EXCERPT = 90;

type Response = {
  ok?: boolean;
  error?: string;
  reason?: string;
  categories?: string[];
  locked?: boolean;
  message?: ChatMessage;
};

/**
 * What the composer is allowed to do in this room.
 *
 * Every value here is also checked on the server. Passing them down is so the
 * member is not offered a button that will be refused: a voice note that turns
 * into "voice notes are off in this room" after they recorded two minutes of it
 * is a worse experience than a mic that was never there.
 */
export type ComposerPermissions = {
  chatLocked: boolean;
  voiceEnabled: boolean;
  mediaEnabled: boolean;
};

export function MessageComposer({
  roomId,
  replyTo,
  onClearReply,
  editing,
  onCancelEdit,
  permissions,
}: {
  roomId: string;
  replyTo: { id: string; author: string; excerpt: string } | null;
  onClearReply: () => void;
  editing: { id: string; content: string } | null;
  onCancelEdit: () => void;
  permissions: ComposerPermissions;
}) {
  const { dict } = useI18n();
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<ChatAttachment[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [prevEditingId, setPrevEditingId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceSession, setVoiceSession] = useState(false);

  // Entering edit mode loads the message into the composer; leaving it drops
  // whatever was typed. Cancel and save both route through here, so the
  // draft can never leak back into a fresh message. The state reset happens
  // during render (guarded by the previous id) rather than in an effect, so
  // there is no extra render pass.
  const editingId = editing?.id ?? null;
  if (editingId !== prevEditingId) {
    setPrevEditingId(editingId);
    setContent(editing?.content ?? "");
    setError(null);
    // Files belong to the post that was being written, not to an edit of
    // something already sent, so staging is cleared along with the draft.
    setStaged([]);
    // A half-open attach menu or a live voice session are not something to
    // carry into an edit either.
    setMenuOpen(false);
    setVoiceSession(false);
  }

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    } else if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [editing]);

  /**
   * Send a file to the moderation route and keep the staged row it returns.
   *
   * This happens before the message is posted, and deliberately so: the file is
   * reviewed and stored on its own, and the post that references it goes out
   * afterwards. If the post then fails, the file is still staged and still only
   * the member can see it, so the send can be retried without re-recording.
   */
  async function upload(kind: AttachmentKind, file: Blob, duration?: number) {
    setUploading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append("file", file);

      const params = new URLSearchParams({ roomId, kind });
      if (content.trim()) params.set("caption", content.trim());
      if (duration !== undefined) {
        params.set("duration", String(Math.round(duration)));
      }

      const response = await fetch(`/api/media/upload?${params}`, {
        method: "POST",
        body: form,
      });

      const data = (await response.json().catch(() => ({}))) as {
        attachment?: ChatAttachment;
        error?: string;
        reason?: string;
        locked?: boolean;
      };

      if (!response.ok || !data.attachment) {
        setError(data.reason ?? data.error ?? dict.community.uploadFailed);
        return false;
      }

      setStaged((prev) => {
        // Four is the server's ceiling for one message, and the room between
        // here and there is where a fifth gets refused.
        const next = [...prev, data.attachment as ChatAttachment];
        return next.slice(0, 4);
      });
      return true;
    } catch {
      setError(dict.community.sendNetworkFailed);
      return false;
    } finally {
      setUploading(false);
    }
  }

  async function pickFile(kind: AttachmentKind, input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const mime = file.type.toLowerCase();
    if (!accepts(kind, mime)) {
      setError(interpolate(dict.community.wrongFileType, { kind }));
      return;
    }
    if (file.size > KIND_LIMITS[kind]) {
      setError(
        interpolate(dict.community.fileTooLarge, { max: formatBytes(KIND_LIMITS[kind]) }),
      );
      return;
    }

    await upload(kind, file);
  }

  async function send() {
    const text = content.trim();
    if (pending || uploading) return;
    if (!text && staged.length === 0) return;

    setPending(true);
    setError(null);

    try {
      // An edit goes through the same gate as a post: the server re-runs
      // moderation on the new text before the service role writes it.
      const response = await fetch(
        editing ? `/api/messages/${editing.id}` : "/api/moderate",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editing
              ? { content: text }
              : {
                  roomId,
                  content: text,
                  replyTo: replyTo?.id ?? null,
                  attachments: staged.map((a) => a.id),
                },
          ),
        },
      );

      const data: Response = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        // A closed room is not a failure to report as one: the notice below
        // already says it, so the error line stays quiet.
        if (!data.locked) {
          setError(
            data.reason ??
              data.error ??
              (editing ? dict.community.editFailed : dict.community.notPosted),
          );
        }
        return;
      }

      setContent("");
      setStaged([]);
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      // The realtime echo arrives on its own; adding the returned row keeps
      // the thread responsive when the socket is slow.
      if (data.message) {
        window.dispatchEvent(
          new CustomEvent<ChatMessage>(
            editing ? "steadfast:message-updated" : "steadfast:optimistic",
            { detail: data.message },
          ),
        );
      }

      if (editing) {
        onCancelEdit();
      } else {
        onClearReply();
      }
    } catch {
      setError(dict.community.sendNetworkFailed);
    } finally {
      setPending(false);
    }
  }

  const remaining = MAX - content.length;
  const canSend = content.trim().length > 0 || staged.length > 0;

  if (permissions.chatLocked) {
    return (
      <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-canvas pt-4 pb-3 safe-b">
        <p className="rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-muted">
          {dict.community.roomClosedNotice}
        </p>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-canvas pt-3 safe-b">
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {editing && (
        <div className="flex items-start gap-3 rounded-xl border-s-2 border-accent bg-accent-soft/40 py-2 ps-3 pe-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-medium text-accent">
              {dict.community.editing}
            </span>
            <span className="truncate text-xs text-muted">
              {editing.content.slice(0, EDIT_EXCERPT)}
            </span>
          </span>
          <button
            type="button"
            onClick={onCancelEdit}
            aria-label={dict.community.cancelEdit}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted transition hover:text-ink"
          >
            {dict.common.cancel}
          </button>
        </div>
      )}

      {replyTo && (
        <div className="flex items-start gap-3 rounded-xl border-s-2 border-accent bg-accent-soft/40 py-2 ps-3 pe-2">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-medium text-accent">
              {interpolate(dict.community.replyingTo, { author: replyTo.author })}
            </span>
            <span className="truncate text-xs text-muted">{replyTo.excerpt}</span>
          </span>
          <button
            type="button"
            onClick={onClearReply}
            aria-label={dict.community.cancelReply}
            className="shrink-0 rounded-lg px-2 py-1 text-xs text-muted transition hover:text-ink"
          >
            {dict.common.cancel}
          </button>
        </div>
      )}

      {staged.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-faint">
            {dict.community.stagedReady}
          </span>
          {staged.map((attachment) => (
            <StagedAttachmentChip
              key={attachment.id}
              attachment={attachment}
              busy={pending || uploading}
              onRemove={() =>
                setStaged((prev) => prev.filter((a) => a.id !== attachment.id))
              }
            />
          ))}
        </div>
      )}

      {uploading && (
        <p className="text-[11px] text-muted" role="status">
          {dict.community.checkingFile}
        </p>
      )}

      <div className="flex items-end gap-2">
        {!editing && voiceSession && permissions.voiceEnabled && (
          <>
            <VoiceRecorder
              key="voice-session"
              autostart
              disabled={uploading || pending}
              onError={setError}
              onRecorded={(clip: RecordedClip) => {
                void upload("audio", clip.blob, clip.durationSeconds).then(
                  () => setVoiceSession(false),
                );
              }}
            />
            <button
              type="button"
              onClick={() => setVoiceSession(false)}
              aria-label={dict.common.cancel}
              title={dict.common.cancel}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line text-muted transition",
                "hover:border-accent hover:text-accent",
              )}
            >
              <CloseGlyph />
            </button>
          </>
        )}

        {!editing &&
          !voiceSession &&
          (permissions.voiceEnabled || permissions.mediaEnabled) && (
            <div className="relative shrink-0">
              <input
                ref={cameraInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                capture="environment"
                className="sr-only"
                onChange={(event) =>
                  void pickFile("image", event.currentTarget)
                }
              />
              <input
                ref={imageInputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                className="sr-only"
                onChange={(event) =>
                  void pickFile("image", event.currentTarget)
                }
              />
              <input
                ref={videoInputRef}
                type="file"
                accept={VIDEO_ACCEPT}
                className="sr-only"
                onChange={(event) =>
                  void pickFile("video", event.currentTarget)
                }
              />

              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                disabled={uploading || pending}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={dict.community.moreActions}
                title={dict.community.moreActions}
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line text-muted transition",
                  "hover:border-accent hover:text-accent",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                  menuOpen && "border-accent text-accent",
                )}
              >
                <MoreGlyph />
              </button>

              {menuOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-10 cursor-default"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    role="menu"
                    className="absolute right-0 bottom-full z-20 mb-2 w-52 overflow-hidden rounded-2xl border border-line bg-surface p-1 shadow-lg shadow-ink/10"
                  >
                    {permissions.voiceEnabled && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setVoiceSession(true);
                        }}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink transition hover:bg-accent-soft/50"
                      >
                        <MicGlyph />
                        {dict.community.voiceStart}
                      </button>
                    )}

                    {permissions.mediaEnabled && (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            imageInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink transition hover:bg-accent-soft/50"
                        >
                          <ImageGlyph />
                          {dict.community.addImage}
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            cameraInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink transition hover:bg-accent-soft/50"
                        >
                          <CameraGlyph />
                          {dict.community.takePhoto}
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            videoInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink transition hover:bg-accent-soft/50"
                        >
                          <VideoGlyph />
                          {dict.community.addVideo}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value.slice(0, MAX));
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            // Enter sends on a keyboard, Shift+Enter breaks the line. Not while
            // a file is being checked, or the caption would post without it.
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              !uploading
            ) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={MAX}
          placeholder={
            editing
              ? dict.community.editing
              : replyTo
                ? dict.community.replying
                : dict.community.placeholder
          }
          aria-label={dict.community.ariaMessage}
          className="max-h-40 flex-1 resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-base leading-relaxed focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />

        <button
          type="button"
          onClick={() => void send()}
          disabled={pending || uploading || !canSend}
          aria-busy={pending}
          className={cn(
            "h-12 shrink-0 rounded-2xl px-5 text-sm font-semibold transition",
            "bg-accent text-accent-contrast hover:bg-accent-strong",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {pending || uploading
            ? "…"
            : editing
              ? dict.community.saveEdit
              : dict.community.send}
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px] text-faint">
        <span>{dict.community.checkedBeforePosting}</span>
        <span>
          {remaining < 200 ? interpolate(dict.community.charsLeft, { n: remaining }) : ""}
          {staged.length > 0
            ? ` · ${interpolate(dict.community.filesChosen, { n: staged.length })}`
            : ""}
        </span>
      </div>
    </div>
  );
}

function ImageGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m4 17 4.5-4.5 3.5 3.5 3-3 5 5" />
    </svg>
  );
}

function VideoGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <rect x="2.5" y="5.5" width="13" height="13" rx="2.5" />
      <path d="m15.5 10.5 6-3.5v10l-6-3.5z" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-5 w-5"
      aria-hidden
    >
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

function CameraGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M4 7.5h2.3l1.4-1.8h8.6l1.4 1.8H20a1.6 1.6 0 0 1 1.6 1.6v8.4A1.6 1.6 0 0 1 20 19H4a1.6 1.6 0 0 1-1.6-1.6V9.1A1.6 1.6 0 0 1 4 7.5Z" />
      <circle cx="12" cy="13.3" r="3.4" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
