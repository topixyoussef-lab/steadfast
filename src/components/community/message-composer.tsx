"use client";

import { useRef, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";
import type { ChatMessage } from "@/lib/types";

const MAX = 2000;

type Response = {
  ok?: boolean;
  error?: string;
  reason?: string;
  categories?: string[];
  message?: ChatMessage;
};

export function MessageComposer({
  roomId,
  replyTo,
  onClearReply,
}: {
  roomId: string;
  replyTo: { id: string; author: string; excerpt: string } | null;
  onClearReply: () => void;
}) {
  const { dict } = useI18n();
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function send() {
    const text = content.trim();
    if (!text || pending) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, content: text, replyTo: replyTo?.id ?? null }),
      });

      const data: Response = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        setError(data.reason ?? data.error ?? dict.community.notPosted);
        return;
      }

      setContent("");
      onClearReply();
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      // The realtime echo arrives on its own; adding the returned row keeps
      // the thread responsive when the socket is slow.
      if (data.message) {
        window.dispatchEvent(
          new CustomEvent<ChatMessage>("steadfast:optimistic", {
            detail: data.message,
          }),
        );
      }
    } catch {
      setError(dict.community.sendNetworkFailed);
    } finally {
      setPending(false);
    }
  }

  const remaining = MAX - content.length;

  return (
    <div className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-canvas pt-3 safe-b">
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-2.5 text-sm text-danger">
          {error}
        </p>
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

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => {
            setContent(e.target.value.slice(0, MAX));
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            // Enter sends on a keyboard, Shift+Enter breaks the line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={MAX}
          placeholder={replyTo ? dict.community.replying : dict.community.placeholder}
          aria-label={dict.community.ariaMessage}
          className="max-h-40 flex-1 resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-base leading-relaxed focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={pending || content.trim().length === 0}
          aria-busy={pending}
          className={cn(
            "h-12 shrink-0 rounded-2xl px-5 text-sm font-semibold transition",
            "bg-accent text-accent-contrast hover:bg-accent-strong",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          {pending ? "…" : dict.community.send}
        </button>
      </div>

      <div className="flex items-center justify-between text-[11px] text-faint">
        <span>{dict.community.checkedBeforePosting}</span>
        <span>
          {remaining < 200 ? interpolate(dict.community.charsLeft, { n: remaining }) : ""}
        </span>
      </div>
    </div>
  );
}