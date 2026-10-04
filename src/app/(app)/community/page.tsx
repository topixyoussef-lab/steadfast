import Link from "next/link";

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
    .select("id, slug, title, description, is_private")
    .order("title");

  const staffRooms = (rooms ?? []).filter((room) => room.is_private);
  const memberRooms = (rooms ?? []).filter((room) => !room.is_private);
  const showSections = staffRooms.length > 0;

  return (
    <main className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.community.title}
        </h1>
        <p className="text-sm text-muted">{dict.community.listIntro}</p>
      </header>

      {showSections && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-faint">
            {dict.community.staffRooms}
          </h2>
          <RoomList rooms={staffRooms} dict={dict} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        {showSections && (
          <h2 className="text-sm font-semibold text-faint">
            {dict.community.userRooms}
          </h2>
        )}
        <RoomList rooms={memberRooms} dict={dict} />
        {rooms?.length === 0 && (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted">
            {dict.community.noRoomsYet}
          </p>
        )}
      </section>
    </main>
  );
}

function RoomList({
  rooms,
  dict,
}: {
  rooms: Pick<Room, "id" | "slug" | "title" | "description" | "is_private">[];
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