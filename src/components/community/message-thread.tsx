"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { MessageComposer } from "@/components/community/message-composer";
import { useI18n } from "@/components/i18n-provider";
import { createClient } from "@/lib/supabase/client";
import { clockTime, pseudonym } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ChatMessage } from "@/lib/types";

type ReplyTarget = { id: string; author: string; excerpt: string };

type Props = {
  roomId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
};

const EXCERPT = 90;

/**
 * Realtime thread, composer, and reply state.
 *
 * The server sends the newest page oldest-first for reading order, and the
 * realtime channel appends new arrivals. Ids are deduplicated because the
 * optimistic message the composer inserts locally and the realtime echo of
 * the same row both arrive within a second of each other.
 *
 * Reply targets are kept out of the message list itself. A quoted parent is
 * resolved from the loaded page by id, so replying to a message that is not
 * loaded is refused rather than leaving a dangling quote.
 */
export function MessageThread({ roomId, currentUserId, initialMessages }: Props) {
  const { dict, locale } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [live, setLive] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Index by id so a quoted parent resolves without a second query.
  const byId = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages],
  );

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as ChatMessage;
          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [...prev, row],
          );
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Lets the composer hand its optimistic row straight to the thread.
  useEffect(() => {
    const onOptimistic = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessage>).detail;
      setMessages((prev) =>
        prev.some((m) => m.id === detail.id) ? prev : [...prev, detail],
      );
    };
    window.addEventListener("steadfast:optimistic", onOptimistic);
    return () => window.removeEventListener("steadfast:optimistic", onOptimistic);
  }, []);

  function startReply(message: ChatMessage) {
    // Quote the message that was actually clicked. When that message is
    // itself a reply, quoting its own parent would attribute someone else's
    // words to this author in the composer preview.
    setReplyTo({
      id: message.id,
      author:
        message.user_id === currentUserId
          ? "you"
          : pseudonym(message.user_id, dict),
      excerpt: message.content.slice(0, EXCERPT),
    });
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-4">
        {!live && (
          <p className="text-center text-[11px] text-faint">
            {dict.community.reconnecting}
          </p>
        )}

        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-10 text-center">
            <p className="text-sm font-medium">{dict.community.noMessages}</p>
            <p className="text-sm text-muted">{dict.community.beFirst}</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) => {
              const mine = message.user_id === currentUserId;
              const author = mine
                ? dict.community.you
                : pseudonym(message.user_id, dict);
              const parent =
                message.reply_to && message.reply_to !== message.id
                  ? byId.get(message.reply_to)
                  : undefined;

              return (
                <li key={message.id} className="flex flex-col gap-1">
                  <span className="flex items-baseline gap-2 text-[11px] text-faint">
                    <span className={cn("font-medium", mine && "text-accent")}>
                      {author}
                    </span>
                    <time dateTime={message.created_at}>
                      {clockTime(message.created_at, locale)}
                    </time>
                  </span>

                  {parent && (
                    <button
                      type="button"
                      onClick={() => startReply(parent)}
                      className="flex w-fit max-w-[85%] flex-col self-start border-s-2 border-line-strong ps-2 text-start transition hover:border-accent"
                    >
                      <span className="text-[11px] font-medium text-muted">
                        {parent.user_id === currentUserId
                          ? dict.community.you
                          : pseudonym(parent.user_id, dict)}
                      </span>
                      <span className="truncate text-xs text-faint">
                        {parent.content.slice(0, EXCERPT)}
                      </span>
                    </button>
                  )}

                  <div
                    className={cn(
                      "w-fit max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                      mine
                        ? "self-end rounded-se-sm bg-accent-soft text-ink"
                        : "rounded-ss-sm border bg-surface",
                      message.is_flagged_by_ai && "border-warning/40",
                    )}
                  >
                    {message.content}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startReply(message)}
                      className="rounded-lg px-1.5 py-0.5 text-[11px] text-faint transition hover:text-accent"
                    >
                      {dict.community.reply}
                    </button>

                    {message.is_flagged_by_ai && (
                      <span className="text-[11px] text-warning">
                        {dict.community.flaggedForReview}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div ref={endRef} />
      </div>

      <MessageComposer
        roomId={roomId}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
      />
    </>
  );
}