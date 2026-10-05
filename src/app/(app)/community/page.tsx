import Link from "next/link";

import { ChatIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/server";
import { requireOnboarded } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Room } from "@/lib/types";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.community.title };
}

export default async function CommunityPage() {
  await requireOnboarded();
  const dict = await getDictionary();

  const supabase = await createClient();
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, slug, title, description, is_private, chat_locked")
    .order("title");

  // The main hall is the live group chat, not a room like the others: it gets
  // its own box at the top of the page instead of a row in the room list.
  const chatRoom = (rooms ?? []).find((room) => room.slug === "main-hall");
  const otherRooms = (rooms ?? []).filter((room) => room.slug !== "main-hall");
  const staffRooms = otherRooms.filter((room) => room.is_private);
  const memberRooms = otherRooms.filter((room) => !room.is_private);
  // "User rooms" only needs its own heading when there is also a staff section
  // to tell it apart from.
  const showSections = staffRooms.length > 0;

  return (
    <main className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.community.title}
        </h1>
        <p className="text-sm text-muted">{dict.community.listIntro}</p>
      </header>

      {chatRoom && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-faint">{dict.nav.chat}</h2>
          <Link
            href={`/community/${chatRoom.slug}`}
            className="flex items-center gap-3 rounded-2xl border border-accent/50 bg-accent-soft p-4 transition hover:border-accent"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-contrast">
              <ChatIcon className="h-5 w-5" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-base font-semibold">{chatRoom.title}</span>
              {chatRoom.description && (
                <span className="text-sm text-muted">{chatRoom.description}</span>
              )}
            </span>
            <span className="ms-auto shrink-0 text-sm font-medium text-accent">
              {chatRoom.chat_locked ? (
                <span className="rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-medium text-danger">
                  {dict.community.roomClosedBadge}
                </span>
              ) : (
                dict.community.open
              )}
            </span>
          </Link>
        </section>
      )}

      {staffRooms.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-faint">
            {dict.community.staffRooms}
          </h2>
          <RoomList rooms={staffRooms} dict={dict} />
        </section>
      )}

      {memberRooms.length > 0 && (
        <section className="flex flex-col gap-3">
          {showSections && (
            <h2 className="text-sm font-semibold text-faint">
              {dict.community.userRooms}
            </h2>
          )}
          <RoomList rooms={memberRooms} dict={dict} />
        </section>
      )}

      {(rooms ?? []).length === 0 && (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted">
          {dict.community.noRoomsYet}
        </p>
      )}
    </main>
  );
}

function RoomList({
  rooms,
  dict,
}: {
  rooms: Pick<
    Room,
    "id" | "slug" | "title" | "description" | "is_private" | "chat_locked"
  >[];
  dict: Dictionary;
}) {
  if (rooms.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed p-4 text-center text-sm text-muted">
        {dict.community.empty}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {rooms.map((room) => (
        <li key={room.id}>
          <Link
            href={`/community/${room.slug}`}
            className="flex flex-col gap-1 rounded-2xl border bg-surface p-4 shadow-sm transition hover:border-accent/60"
          >
            <span className="flex items-center gap-2 text-base font-semibold">
              {room.title}
              {room.is_private && (
                <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-faint">
                  {dict.community.staffOnly}
                </span>
              )}
              {room.chat_locked && (
                <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-medium text-danger">
                  {dict.roomControls.closed}
                </span>
              )}
            </span>
            {room.description && (
              <span className="text-sm text-muted">{room.description}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}