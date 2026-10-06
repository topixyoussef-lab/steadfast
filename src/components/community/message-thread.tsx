"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { MessageComposer } from "@/components/community/message-composer";
import { AttachmentView } from "@/components/community/attachment-view";
import { LinkPreviewCard } from "@/components/community/link-preview-card";
import {
  LinkifiedText,
  firstUrl,
  messagePreview,
} from "@/components/community/linkified-text";
import { useI18n } from "@/components/i18n-provider";
import { createClient } from "@/lib/supabase/client";
import { MESSAGE_COLUMNS, MESSAGE_COLUMNS_BASE } from "@/lib/chat";
import { clockTime, pseudonym } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ChatAttachment, ChatMessage, MessageReaction } from "@/lib/types";

type ReplyTarget = { id: string; author: string; excerpt: string };

type Props = {
  roomId: string;
  currentUserId: string;
  staffIds: string[];
  initialMessages: ChatMessage[];
  initialReactions: MessageReaction[];
  chatLocked: boolean;
  voiceEnabled: boolean;
  mediaEnabled: boolean;
  /**
   * Whether this database has the 0009 columns. The server page already had to
   * ask in order to read the room, and the poll has to match that answer:
   * asking for the attachments embed on an un-migrated database is an error, so
   * the poll would come back empty and the thread would stop updating.
   */
  mediaReady: boolean;
};

const EXCERPT = 90;

/** How often the thread re-reads the database for rows Realtime may not have delivered. */
const POLL_MS = 8000;

/**
 * How far back each poll re-reads.
 *
 * Posting writes the message row and then claims its attachments, and the two
 * are separate statements. A poll landing between them reads a message with no
 * attachments and would never look at that row again, since the watermark only
 * moves forward -- leaving a photo that appears on reload and nowhere else. A
 * two-second overlap closes that window for the cost of re-reading the last
 * second or so of traffic, and `upsertMessage` makes the overlap a no-op for
 * rows that have not changed.
 */
const POLL_OVERLAP_MS = 2000;

/** Must match the CHECK constraint on chat_message_reactions.emoji (0006). */
const REACTION_SET = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

type ReactionGroup = { emoji: string; count: number; mine: boolean };

/**
 * Realtime thread, composer, reply state, reactions, attachments, and message
 * actions.
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
 * Attachments need care of their own. A realtime INSERT on chat_messages carries
 * the message columns and nothing else, so a naive upsert would replace a row
 * that has files attached with one that appears to have none, and the picture
 * would vanish from under the member who just posted it. The upsert therefore
 * keeps whichever copy actually has attachments, and a second channel on
 * chat_message_attachments carries a file that arrives on its own.
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
  chatLocked,
  voiceEnabled,
  mediaEnabled,
  mediaReady,
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
  const loadedMessageIds = useRef<string[]>(
    initialMessages.map((message) => message.id),
  );
  const reactionWriteInProgress = useRef(false);
  // An edit rewrites a row without moving its created_at, so the new-message
  // watermark above cannot catch it. This one tracks the newest edited_at this
  // tab has seen, and starts from what the server already rendered rather than
  // from the client clock, which may disagree with the database.
  const editedSeenRef = useRef<string>(
    initialMessages.reduce((latest, message) => {
      const stamp =
        message.edited_at && message.edited_at > message.created_at
          ? message.edited_at
          : message.created_at;
      return stamp > latest ? stamp : latest;
    }, "0"),
  );

  const dropMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    setReactions((prev) => prev.filter((r) => r.message_id !== id));
    setEditing((prev) => (prev?.id === id ? null : prev));
    setReplyTo((prev) => (prev?.id === id ? null : prev));
    setPickerFor((prev) => (prev === id ? null : prev));
  }, []);

  /**
   * Merge an incoming copy of a message.
   *
   * The attachment rule is the reason this is not a plain assignment. A realtime
   * event on chat_messages carries no `attachments`, so writing it over a row
   * that has them would make a just-posted photo disappear until the next poll.
   * The row that has attachments wins unless the incoming copy has some too.
   */
  const upsertMessage = useCallback(
    (row: ChatMessage) => {
      if (row.deleted_at) {
        dropMessage(row.id);
        return;
      }
      setMessages((prev) => {
        const existing = prev.find((m) => m.id === row.id);
        const merged =
          existing && (existing.attachments?.length ?? 0) > 0 &&
          (row.attachments?.length ?? 0) === 0
            ? { ...row, attachments: existing.attachments }
            : row;
        return existing
          ? prev.map((m) => (m.id === merged.id ? merged : m))
          : [...prev, merged];
      });
    },
    [dropMessage],
  );

  /** A file that arrives on its own, or is removed with its message. */
  const upsertAttachment = useCallback(
    (row: ChatAttachment) => {
      if (!row.message_id) return; // staged: not in any message yet
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== row.message_id) return m;
          const list = m.attachments ?? [];
          const already = list.some((a) => a.id === row.id);
          return {
            ...m,
            attachments: already
              ? list.map((a) => (a.id === row.id ? row : a))
              : [...list, row],
          };
        }),
      );
    },
    [],
  );

  const dropAttachment = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        (m.attachments ?? []).some((a) => a.id === id)
          ? { ...m, attachments: (m.attachments ?? []).filter((a) => a.id !== id) }
          : m,
      ),
    );
  }, []);

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

    let channel = supabase
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
      );

      // The attachment table is 0009. Asking Realtime for a table the database does
      // not have leaves the channel unable to report SUBSCRIBED, and this thread
      // renders "not subscribed" as a permanent "reconnecting" line over an
      // otherwise working room. So on a database the migration has not reached,
      // the two listeners that name it are left off altogether: there is nothing
      // they could deliver until then, and leaving them out is what keeps the rest
      // of the channel healthy.
      if (mediaReady) {
        channel = channel
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "chat_message_attachments",
              // UPDATE, not INSERT: the row was inserted by the upload route while
              // it was still staged and the claim is the UPDATE that attaches it to
              // a message. Filtering on message_id being non-null is therefore also
              // the RLS boundary -- a staged file is invisible to everyone but its
              // uploader, so an unfiltered INSERT would only ever deliver the uploader
              // their own half-finished upload and nothing useful to anyone else.
              filter: "message_id=not.is.null",
            },
            (payload) => upsertAttachment(payload.new as ChatAttachment),
          )
          .on(
            "postgres_changes",
            {
              event: "DELETE",
              schema: "public",
              table: "chat_message_attachments",
            },
            (payload) => {
              const old = payload.old as Partial<ChatAttachment>;
              if (old?.id) dropAttachment(old.id);
            },
          );
      }

      channel
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
  }, [
    roomId,
    mediaReady,
    upsertMessage,
    dropMessage,
    addReaction,
    dropReaction,
    upsertAttachment,
    dropAttachment,
  ]);

  // A channel can report SUBSCRIBED and still deliver nothing, which is what a
  // table missing from the supabase_realtime publication looks like. This pulls
  // what the channel should have carried: rows newer than the last message seen,
  // rows edited since the last edit seen, and the current reaction set for the
  // loaded page, which is the only way an added or removed chip shows up without
  // Realtime. A soft delete made by someone else still needs a refresh, because
  // that row stops matching the read policy.
  useEffect(() => {
    const supabase = createClient();

    async function poll() {
      // `gte` against a watermark pulled back by POLL_OVERLAP_MS rather than
      // `gt` against the last row seen: a message written a moment before the
      // claim of its attachments would otherwise be read once, without them, and
      // never again.
      const since = new Date(
        Date.parse(lastSeenRef.current) - POLL_OVERLAP_MS,
      ).toISOString();

      const { data } = await supabase
        .from("chat_messages")
        .select(mediaReady ? MESSAGE_COLUMNS : MESSAGE_COLUMNS_BASE)
        .eq("room_id", roomId)
        .is("deleted_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(50)
        .returns<ChatMessage[]>();

      const rows = data ?? [];
      if (rows.length > 0) {
        // The watermark advances only on rows actually past it, otherwise the
        // overlap would walk it backwards one poll at a time.
        const newest = rows[rows.length - 1].created_at;
        if (newest > lastSeenRef.current) lastSeenRef.current = newest;
        for (const row of rows) upsertMessage(row);
      }

      const ids = loadedMessageIds.current;
      if (ids.length === 0) return;

      // Edits keep their original created_at, so the query above is blind to
      // them. Re-read rows edited since this tab's watermark, but only apply the
      // ones already in view — an edit to a message outside the loaded page must
      // not drop that message at the bottom of the thread.
      const { data: edited } = await supabase
        .from("chat_messages")
        .select(mediaReady ? MESSAGE_COLUMNS : MESSAGE_COLUMNS_BASE)
        .eq("room_id", roomId)
        .is("deleted_at", null)
        .gt("edited_at", editedSeenRef.current)
        .order("edited_at", { ascending: true })
        .limit(50)
        .returns<ChatMessage[]>();

      const loaded = new Set(ids);
      const edits = edited ?? [];
      for (const row of edits) {
        if (row.edited_at) editedSeenRef.current = row.edited_at;
        if (loaded.has(row.id)) upsertMessage(row);
      }

      if (reactionWriteInProgress.current) return;

      const { data: fresh } = await supabase
        .from("chat_message_reactions")
        .select("id, message_id, user_id, emoji, created_at")
        .in("message_id", ids);

      if (fresh) setReactions(fresh as MessageReaction[]);
    }

    // A hidden tab gets its timers throttled to about a minute, so the moment
    // it comes back into view it asks for whatever it missed instead of waiting
    // out the interval.
    const onVisible = () => {
      if (!document.hidden) void poll();
    };

    const timer = setInterval(() => void poll(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [roomId, upsertMessage, mediaReady]);

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
      if (!detail?.id) return;
      if (detail.edited_at && detail.edited_at > editedSeenRef.current) {
        // This tab already holds the new text, so the poll must not fetch an
        // older copy of the row and revert what the member just typed.
        editedSeenRef.current = detail.edited_at;
      }
      upsertMessage(detail);
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

  // The poll reads this ref instead of depending on `messages`, which would
  // restart the timer on every arrival.
  useEffect(() => {
    loadedMessageIds.current = messages.map((message) => message.id);
  }, [messages]);

  // Members cannot read other profiles, so the room page resolves the staff
  // roles with the service role and hands the ids over.
  const staffSet = useMemo(() => new Set(staffIds), [staffIds]);

  // Staff may hide anyone's message, so the delete action also appears on other
  // people's bubbles. The route re-checks the role on every request; this only
  // decides what to show.
  const amStaff = staffSet.has(currentUserId);

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
      // A file-only message has no text to quote, so the preview says what it
      // is instead of showing an empty line.
      excerpt:
        message.content.trim().length > 0
          ? messagePreview(message.content, EXCERPT)
          : dict.community.attachmentSummary,
    });
  }

  function startEdit(message: ChatMessage) {
    setReplyTo(null);
    setPickerFor(null);
    setEditing({ id: message.id, content: message.content });
  }

  async function deleteMessage(message: ChatMessage) {
    // A member removing their own message and a moderator removing someone
    // else's are different decisions, so they ask differently.
    const bySomeoneElse = message.user_id !== currentUserId;
    const confirmText = bySomeoneElse
      ? dict.community.confirmDeleteByStaff
      : dict.community.confirmDelete;

    if (!window.confirm(confirmText)) return;

    setActionError(null);

    // The live database rejects member writes to chat_messages, so removing a
    // message goes through the server route, which re-checks that the caller is
    // either the author or staff and stamps deleted_at with the service role.
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

  async function applyReactionToggle(message: ChatMessage, emoji: string) {
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

  // The poll re-reads the whole reaction set, so it has to stand down while this
  // write is in flight. Without the pause, the chip a member just tapped
  // flickers out until the server row comes back, and a chip they just removed
  // flickers back in until the delete lands.
  async function toggleReaction(message: ChatMessage, emoji: string) {
    reactionWriteInProgress.current = true;
    try {
      await applyReactionToggle(message, emoji);
    } finally {
      reactionWriteInProgress.current = false;
    }
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-4">
        {/* Nothing is said about a locked room here on purpose. The composer
            takes the bottom of the thread and replaces itself with that notice,
            and a second copy floating above the history would be the same
            sentence twice on one screen. */}
        {!chatLocked && !voiceEnabled && (
          <p className="text-center text-[11px] text-faint">
            {dict.community.voiceOffNotice}
          </p>
        )}

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
              const attachments = message.attachments ?? [];
              const hasFiles = attachments.length > 0;
              // One card per message, from the same address the text above it
              // turned into an anchor. The two go through `firstUrl` together so
              // a message can never show a card for something it does not link.
              const previewUrl = firstUrl(message.content ?? "");

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
                        {hasFiles
                          ? dict.community.attachmentSummary
                          : parent.content.slice(0, EXCERPT)}
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
                    {message.content && <LinkifiedText text={message.content} />}

                    {/* A message cannot change URL, but an edit can: keying by
                        url remounts the card so it cannot show the previous
                        link's preview while the new one loads. */}
                    <LinkPreviewCard
                      key={previewUrl ?? "none"}
                      url={previewUrl}
                    />

                    {attachments.length > 0 && (
                      <div
                        className={cn(
                          "flex flex-col gap-2",
                          message.content && "mt-2 pt-2 border-t border-line/60",
                        )}
                      >
                        {attachments.map((attachment) => (
                          <AttachmentView
                            key={attachment.id}
                            attachment={attachment}
                            mine={mine}
                          />
                        ))}
                      </div>
                    )}
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

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => startReply(message)}
                      className="rounded-full bg-sunken px-3 py-1 text-xs font-medium text-muted transition hover:text-ink"
                    >
                      {dict.community.reply}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setPickerFor(pickerFor === message.id ? null : message.id)
                      }
                      className="rounded-full bg-sunken px-3 py-1 text-xs font-medium text-muted transition hover:text-ink"
                    >
                      {dict.community.react}
                    </button>

                    {mine && (
                      <button
                        type="button"
                        onClick={() => startEdit(message)}
                        className="rounded-full bg-sunken px-3 py-1 text-xs font-medium text-muted transition hover:text-ink"
                      >
                        {dict.community.edit}
                      </button>
                    )}

                    {(mine || amStaff) && (
                      <button
                        type="button"
                        onClick={() => void deleteMessage(message)}
                        className="rounded-full bg-sunken px-3 py-1 text-xs font-medium text-muted transition hover:text-danger"
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
        permissions={{ chatLocked, voiceEnabled, mediaEnabled }}
      />
    </>
  );
}
