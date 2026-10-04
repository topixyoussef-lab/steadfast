"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { MessageComposer } from "@/components/community/message-composer";
import { useI18n } from "@/components/i18n-provider";
import { createClient } from "@/lib/supabase/client";
import { MESSAGE_COLUMNS } from "@/lib/chat";
import { clockTime, pseudonym } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ChatMessage, MessageReaction } from "@/lib/types";

type ReplyTarget = { id: string; author: string; excerpt: string };

type Props = {
  roomId: string;
  currentUserId: string;
  staffIds: string[];
  initialMessages: ChatMessage[];
  initialReactions: MessageReaction[];
};

const EXCERPT = 90;

/** How often the thread re-reads the database for rows Realtime may not have delivered. */
const POLL_MS = 8000;

/** Must match the CHECK constraint on chat_message_reactions.emoji (0006). */
const REACTION_SET = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

type ReactionGroup = { emoji: string; count: number; mine: boolean };

/**
 * Realtime thread, composer, reply state, reactions, and message actions.
 *
 * The server sends the newest page oldest-first for reading order, and the
 * realtime channel appends new arrivals. Ids are deduplicated because the
 * optimistic message the composer inserts locally and the realtime echo of
 * the same row both arrive within a second of each other.
 *
 * Two writes cannot travel as postgres_changes and go over channel broadcast
 * instead:
 *  - soft deletes, because the new row fails the chat_read policy and
 *    Realtime drops the event for everyone;
 *  - reaction removals, because the delete policy only exposes the old row to
 *    its owner, so nobody else would hear about it.
 * Broadcast payloads carry ids only, never message content.
 *
 * Reply targets are kept out of the message list itself. A quoted parent is
 * resolved from the loaded page by id, so replying to a message that is not
 * loaded is refused rather than leaving a dangling quote.
 */
export function MessageThread({
  roomId,
  currentUserId,
  staffIds,
  initialMessages,
  initialReactions,
}: Props) {
  const { dict, locale } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [reactions, setReactions] = useState<MessageReaction[]>(initialReactions);
  const [live, setLive] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSeenRef = useRef<string>(
    initialMessages.length > 0
      ? initialMessages[initialMessages.length - 1].created_at
      : new Date().toISOString(),
  );

  const dropMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setReactions((prev) => prev.filter((r) => r.message_id !== id));
    setEditing((prev) => (prev?.id === id ? null : prev));
    setReplyTo((prev) => (prev?.id === id ? null : prev));
    setPickerFor((prev) => (prev === id ? null : prev));
  }, []);

  const upsertMessage = useCallback(
    (row: ChatMessage) => {
      if (row.deleted_at) {
        dropMessage(row.id);
        return;
      }
      setMessages((prev) =>
        prev.some((m) => m.id === row.id)
          ? prev.map((m) => (m.id === row.id ? row : m))
          : [...prev, row],
      );
    },
    [dropMessage],
  );

  const addReaction = useCallback((row: MessageReaction) => {
    setReactions((prev) =>
      prev.some(
        (r) =>
          r.id === row.id ||
          (r.message_id === row.message_id &&
            r.user_id === row.user_id &&
            r.emoji === row.emoji),
      )
        ? prev
        : [...prev, row],
    );
  }, []);

  const dropReaction = useCallback(
    (match: Partial<MessageReaction>) => {
      setReactions((prev) =>
        prev.filter((r) => {
          if (match.id && r.id === match.id) return false;
          if (
            match.message_id &&
            r.message_id === match.message_id &&
            r.user_id === match.user_id &&
            r.emoji === match.emoji
          ) {
            return false;
          }
          return true;
        }),
      );
    },
    [],
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
        (payload) => upsertMessage(payload.new as ChatMessage),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => upsertMessage(payload.new as ChatMessage),
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "chat_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const old = payload.old as Partial<ChatMessage>;
          if (old?.id) dropMessage(old.id);
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_message_reactions" },
        (payload) => addReaction(payload.new as MessageReaction),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_message_reactions" },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (old) dropReaction(old);
        },
      )
      .on("broadcast", { event: "message-deleted" }, ({ payload }) => {
        const id = (payload as { id?: string } | null)?.id;
        if (id) dropMessage(id);
      })
      .on("broadcast", { event: "reaction-removed" }, ({ payload }) => {
        const row = payload as Partial<MessageReaction> | null;
        if (row?.id || row?.message_id) dropReaction(row);
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [roomId, upsertMessage, dropMessage, addReaction, dropReaction]);

  // A channel can report SUBSCRIBED and still deliver nothing, which is what a
  // table missing from the supabase_realtime publication looks like. This pulls
  // anything newer than the last row the thread has seen, so the room keeps
  // working while that is sorted out. Only new rows: removals still travel over
  // Realtime, so a delete made here needs the other member to refresh.
  useEffect(() => {
    const supabase = createClient();

    async function poll() {
      if (document.hidden) return;

      const { data } = await supabase
        .from("chat_messages")
        .select(MESSAGE_COLUMNS)
        .eq("room_id", roomId)
        .is("deleted_at", null)
        .gt("created_at", lastSeenRef.current)
        .order("created_at", { ascending: true })
        .limit(50);

      const rows = (data as ChatMessage[]) ?? [];
      if (rows.length === 0) return;

      lastSeenRef.current = rows[rows.length - 1].created_at;
      for (const row of rows) upsertMessage(row);

      const { data: reactionRows } = await supabase
        .from("chat_message_reactions")
        .select("id, message_id, user_id, emoji, created_at")
        .in(
          "message_id",
          rows.map((row) => row.id),
        );

      for (const row of (reactionRows as MessageReaction[]) ?? []) addReaction(row);
    }

    const timer = setInterval(() => void poll(), POLL_MS);

    return () => clearInterval(timer);
  }, [roomId, upsertMessage, addReaction]);

  // Only a new message should pull the view down. Deleting or editing an old
  // one must not yank the reader to the bottom of the room.
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  // Lets the composer hand its optimistic row straight to the thread: a new
  // message, or the result of an edit.
  useEffect(() => {
    const onOptimistic = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessage>).detail;
      setMessages((prev) =>
        prev.some((m) => m.id === detail.id) ? prev : [...prev, detail],
      );
    };
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessage>).detail;
      if (detail?.id) upsertMessage(detail);
    };
    window.addEventListener("steadfast:optimistic", onOptimistic);
    window.addEventListener("steadfast:message-updated", onUpdated);
    return () => {
      window.removeEventListener("steadfast:optimistic", onOptimistic);
      window.removeEventListener("steadfast:message-updated", onUpdated);
    };
  }, [upsertMessage]);

  // Index by id so a quoted parent resolves without a second query.
  const byId = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages],
  );

  // Members cannot read other profiles, so the room page resolves the staff
  // roles with the service role and hands the ids over.
  const staffSet = useMemo(() => new Set(staffIds), [staffIds]);

  const reactionGroups = useMemo(() => {
    const map = new Map<string, ReactionGroup[]>();
    for (const reaction of reactions) {
      const groups = map.get(reaction.message_id) ?? [];
      let group = groups.find((g) => g.emoji === reaction.emoji);
      if (!group) {
        group = { emoji: reaction.emoji, count: 0, mine: false };
        groups.push(group);
      }
      group.count += 1;
      if (reaction.user_id === currentUserId) group.mine = true;
      map.set(reaction.message_id, groups);
    }
    return map;
  }, [reactions, currentUserId]);

  function startReply(message: ChatMessage) {
    // Quote the message that was actually clicked. When that message is
    // itself a reply, quoting its own parent would attribute someone else's
    // words to this author in the composer preview.
    setEditing(null);
    setPickerFor(null);
    setReplyTo({
      id: message.id,
      author:
        message.user_id === currentUserId
          ? dict.community.youLower
          : pseudonym(message.user_id, dict),
      excerpt: message.content.slice(0, EXCERPT),
    });
  }

  function startEdit(message: ChatMessage) {
    setReplyTo(null);
    setPickerFor(null);
    setEditing({ id: message.id, content: message.content });
  }

  async function deleteMessage(message: ChatMessage) {
    if (!window.confirm(dict.community.confirmDelete)) return;

    setActionError(null);

    // The live database rejects member writes to chat_messages, so the soft
    // delete goes through the server route, which checks ownership and
    // stamps deleted_at with the service role.
    const response = await fetch(`/api/messages/${message.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setActionError(dict.community.deleteFailed);
      return;
    }

    // Realtime cannot carry this one: the new row fails the read policy, so
    // the event never reaches subscribers. Tell them over the channel.
    void channelRef.current?.send({
      type: "broadcast",
      event: "message-deleted",
      payload: { id: message.id },
    });

    dropMessage(message.id);
  }

  async function toggleReaction(message: ChatMessage, emoji: string) {
    setPickerFor(null);
    setActionError(null);

    const mine = reactions.find(
      (r) =>
        r.message_id === message.id &&
        r.user_id === currentUserId &&
        r.emoji === emoji,
    );
    const supabase = createClient();

    if (mine) {
      dropReaction({ id: mine.id });
      const { error } = await supabase
        .from("chat_message_reactions")
        .delete()
        .eq("id", mine.id);

      if (error) {
        addReaction(mine);
        setActionError(dict.community.reactFailed);
        return;
      }

      // Only the row's owner is allowed to see it in a DELETE event, so the
      // other members need the broadcast to drop the chip.
      void channelRef.current?.send({
        type: "broadcast",
        event: "reaction-removed",
        payload: {
          id: mine.id,
          message_id: mine.message_id,
          user_id: mine.user_id,
          emoji: mine.emoji,
        },
      });
      return;
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    addReaction({
      id: tempId,
      message_id: message.id,
      user_id: currentUserId,
      emoji,
      created_at: new Date().toISOString(),
    });

    // user_id comes from the column default, auth.uid(); the insert policy
    // checks it either way.
    const { data, error } = await supabase
      .from("chat_message_reactions")
      .insert({ message_id: message.id, emoji })
      .select("id, message_id, user_id, emoji, created_at")
      .single();

    if (error || !data) {
      dropReaction({ id: tempId });
      setActionError(dict.community.reactFailed);
      return;
    }

    setReactions((prev) => [
      ...prev.filter((r) => r.id !== tempId && r.id !== data.id),
      data,
    ]);
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-4">
        {!live && (
          <p className="text-center text-[11px] text-faint">
            {dict.community.reconnecting}
          </p>
        )}

        {actionError && (
          <p
            role="alert"
            className="rounded-xl bg-danger-soft px-4 py-2.5 text-sm text-danger"
          >
            {actionError}
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
              const staff = staffSet.has(message.user_id);
              const author = mine
                ? dict.community.you
                : pseudonym(message.user_id, dict);
              const parent =
                message.reply_to && message.reply_to !== message.id
                  ? byId.get(message.reply_to)
                  : undefined;
              const groups = reactionGroups.get(message.id) ?? [];

              return (
                <li key={message.id} className="flex flex-col gap-1">
                  <span className="flex items-baseline gap-2 text-[11px] text-faint">
                    <span className={cn("font-medium", mine && "text-accent")}>
                      {author}
                    </span>
                    {staff && (
                      <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-accent-contrast">
                        {dict.community.staffBadge}
                      </span>
                    )}
                    <time dateTime={message.created_at}>
                      {clockTime(message.created_at, locale)}
                    </time>
                    {message.edited_at && <span>{dict.community.edited}</span>}
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
                        {staffSet.has(parent.user_id) && (
                          <span className="ms-1 text-accent">
                            {dict.community.staffBadge}
                          </span>
                        )}
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
                        : cn(
                            "rounded-ss-sm border bg-surface",
                            staff && "border-s-[3px] border-s-accent bg-accent-soft/30",
                          ),
                      message.is_flagged_by_ai && "border-warning/40",
                    )}
                  >
                    {message.content}
                  </div>

                  {groups.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      {groups.map((group) => (
                        <button
                          key={group.emoji}
                          type="button"
                          onClick={() => void toggleReaction(message, group.emoji)}
                          aria-pressed={group.mine}
                          className={cn(
                            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition",
                            group.mine
                              ? "border-accent bg-accent-soft"
                              : "bg-surface hover:border-accent/60",
                          )}
                        >
                          <span>{group.emoji}</span>
                          <span className="text-[11px] text-muted">
                            {group.count}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {pickerFor === message.id && (
                    <div className="flex w-fit items-center gap-1 rounded-full border bg-surface px-2 py-1 shadow-sm">
                      {REACTION_SET.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => void toggleReaction(message, emoji)}
                          aria-label={emoji}
                          className="rounded-full px-1.5 py-0.5 text-base leading-none transition hover:bg-sunken"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startReply(message)}
                      className="rounded-lg px-1.5 py-0.5 text-[11px] text-faint transition hover:text-accent"
                    >
                      {dict.community.reply}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setPickerFor(pickerFor === message.id ? null : message.id)
                      }
                      className="rounded-lg px-1.5 py-0.5 text-[11px] text-faint transition hover:text-accent"
                    >
                      {dict.community.react}
                    </button>

                    {mine && (
                      <button
                        type="button"
                        onClick={() => startEdit(message)}
                        className="rounded-lg px-1.5 py-0.5 text-[11px] text-faint transition hover:text-accent"
                      >
                        {dict.community.edit}
                      </button>
                    )}

                    {mine && (
                      <button
                        type="button"
                        onClick={() => void deleteMessage(message)}
                        className="rounded-lg px-1.5 py-0.5 text-[11px] text-faint transition hover:text-danger"
                      >
                        {dict.common.delete}
                      </button>
                    )}

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
        editing={editing}
        onCancelEdit={() => setEditing(null)}
      />
    </>
  );
}
