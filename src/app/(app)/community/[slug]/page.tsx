import Link from "next/link";
import { notFound } from "next/navigation";

import { MessageThread } from "@/components/community/message-thread";
import { BackIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/server";
import { requireOnboarded, getStaffUserIds } from "@/lib/dal";
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
  const { data: room } = await supabase
    .from("rooms")
    .select("id, slug, title, description, is_private")
    .eq("slug", slug)
    .single<Room>();

  if (!room) notFound();
  if (room.is_private && profile.role === "user") notFound();

  // Descending so the LIMIT keeps the newest 100 rows, then reversed so the
  // thread reads oldest-to-newest and the composer sits under the newest one.
  const [{ data: messages }, staffIds] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("id, room_id, user_id, content, is_flagged_by_ai, moderation_status, reply_to, created_at, edited_at, deleted_at")
      .eq("room_id", room.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    getStaffUserIds(),
  ]);

  const initialMessages = [...(messages ?? [])].reverse() as ChatMessage[];

  // Pre-migration this table does not exist yet; an error just means no
  // reaction chips until 0006 is applied.
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
      </header>

      <MessageThread
        roomId={room.id}
        currentUserId={profile.id}
        staffIds={staffIds}
        initialMessages={initialMessages}
        initialReactions={initialReactions}
      />
    </main>
  );
}