import Link from "next/link";
import { notFound } from "next/navigation";

import { MessageThread } from "@/components/community/message-thread";
import { BackIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/server";
import { requireOnboarded, getStaffUserIds } from "@/lib/dal";
import { MESSAGE_COLUMNS, MESSAGE_COLUMNS_BASE, ROOM_COLUMNS, ROOM_COLUMNS_BASE } from "@/lib/chat";
import { chatMediaReady } from "@/lib/chat-schema";
import { getDictionary } from "@/lib/i18n/server";
import type { ChatMessage, MessageReaction, Room } from "@/lib/types";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.nav.communityRooms };
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const profile = await requireOnboarded();
  const dict = await getDictionary();

  const supabase = await createClient();

  // Asked once and used for both selects below: they are the same shape or the
  // pre-0009 shape, and mixing the two would put a room with no attachments next
  // to a room with them for no reason the member could explain.
  const mediaReady = await chatMediaReady();

  const { data: room } = await supabase
    .from("rooms")
    .select(mediaReady ? ROOM_COLUMNS : ROOM_COLUMNS_BASE)
    .eq("slug", slug)
    .single<Room>();

  if (!room) notFound();
  if (room.is_private && profile.role === "user") notFound();

  // False until the migration says otherwise, so an un-migrated database reads
  // as "posting is open" the way it did before 0009 existed. The media flags go
  // the other way: an absent column means no way to ask, so they read as off.
  const chatLocked = room.chat_locked ?? false;
  const voiceEnabled = room.voice_enabled ?? false;
  const mediaEnabled = room.media_enabled ?? false;

  // Descending so the LIMIT keeps the newest 100 rows, then reversed so the
  // thread reads oldest-to-newest and the composer sits under the newest one.
  const [{ data: messages }, staffIds] = await Promise.all([
    supabase
      .from("chat_messages")
      .select(mediaReady ? MESSAGE_COLUMNS : MESSAGE_COLUMNS_BASE)
      .eq("room_id", room.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    getStaffUserIds(),
  ]);

  // `as unknown`: supabase-js reads the row shape from the type of the select
  // string, and the ternary above is a union of literals it cannot parse.
  const initialMessages = [...(messages ?? [])].reverse() as unknown as ChatMessage[];

  // The reaction table only arrives in 0006. An error just means no chips until
  // the migration is applied; the room still renders.
  const { data: reactions } = await supabase
    .from("chat_message_reactions")
    .select("id, message_id, user_id, emoji, created_at")
    .in(
      "message_id",
      initialMessages.map((m) => m.id),
    );

  const initialReactions = (reactions ?? []) as MessageReaction[];

  return (
    <main className="flex min-h-dvh w-full flex-col gap-4 px-5 py-6 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-2">
        <Link
          href="/community"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
        >
          <BackIcon className="h-4 w-4 rtl:rotate-180" />
          {dict.nav.communityRooms}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{room.title}</h1>
        {room.description && (
          <p className="text-sm text-muted">{room.description}</p>
        )}
        {chatLocked && (
          <span className="w-fit rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-medium text-danger">
            {dict.community.roomClosedBadge}
          </span>
        )}
      </header>

      <MessageThread
        roomId={room.id}
        currentUserId={profile.id}
        staffIds={staffIds}
        initialMessages={initialMessages}
        initialReactions={initialReactions}
        chatLocked={chatLocked}
        voiceEnabled={voiceEnabled}
        mediaEnabled={mediaEnabled}
      />
    </main>
  );
}