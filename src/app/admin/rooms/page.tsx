import Link from "next/link";

import { RoomSwitchActions } from "@/components/admin/room-switch-actions";
import { DoorIcon } from "@/components/icons";
import { requireStaff } from "@/lib/dal";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import type { Room } from "@/lib/types";
import { ROOM_COLUMNS, ROOM_COLUMNS_BASE } from "@/lib/chat";
import { chatMediaReady } from "@/lib/chat-schema";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.console.rooms };
}

/**
 * Every room, with the three switches that decide what it accepts.
 *
 * Admin-only on purpose. `rooms_admin_write` lets any staff role update a room,
 * which is right for the room name and description but not for taking a room
 * offline for every member at once -- so this page re-checks for the admin role
 * and the actions refuse anyone else.
 */
export default async function AdminRoomsPage() {
  const profile = await requireStaff();
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);

  if (profile.role !== "admin") {
    return (
      <main className="flex w-full flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.roomControls.title}
        </h1>
        <p className="text-sm text-muted">{dict.admin.noPermission}</p>
      </main>
    );
  }

  const supabase = await createClient();

  // The switches are 0009 columns. Naming a column that is not there is a
  // PostgREST error rather than a null, so the select below would come back with
  // no rows and this page would report "no rooms" on a database that plainly has
  // them. The probe is the same one the member-facing pages use, so the whole app
  // reads one answer about whether 0009 has landed.
  const mediaReady = await chatMediaReady();

  // A ternary of literal strings is a union, and supabase-js cannot infer a row
  // type from a union -- it falls back to its ParserError marker. `.returns<>()`
  // names the shape instead of letting the parser guess.
  const { data: rooms } = await supabase
    .from("rooms")
    .select(`${mediaReady ? ROOM_COLUMNS : ROOM_COLUMNS_BASE}, created_at`)
    .returns<Room[]>()
    .order("is_private", { ascending: true })
    .order("title", { ascending: true });

  const rows = (rooms ?? []).map((room) => ({
    ...room,
    // Absent until 0009 lands, so the switches read as off and stay hidden.
    chat_locked: room.chat_locked ?? false,
    voice_enabled: room.voice_enabled ?? false,
    media_enabled: room.media_enabled ?? false,
  }));

  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.roomControls.title}
        </h1>
        <p className="text-sm text-muted">{dict.console.roomsIntro}</p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{dict.roomControls.noRooms}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {rows.map((room) => (
            <li
              key={room.id}
              className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <Link
                  href={`/community/${room.slug}`}
                  className="flex items-center gap-2 font-medium text-ink hover:underline"
                >
                  <DoorIcon className="h-4 w-4 shrink-0 text-faint" />
                  {room.title}
                </Link>
                {room.description && (
                  <p className="text-sm text-muted">{room.description}</p>
                )}
                <p className="text-[11px] text-faint">
                  /{room.slug}
                  {room.created_at &&
                    ` · ${formatDate(room.created_at, locale)}`}
                </p>
              </div>

              {!mediaReady && (
                <p className="text-xs text-muted">
                  {dict.roomControls.switchesUnavailable}
                </p>
              )}

              {mediaReady && (
                <RoomSwitchActions
                  roomId={room.id}
                  isPrivate={room.is_private}
                  initial={{
                    chat_locked: room.chat_locked,
                    voice_enabled: room.voice_enabled,
                    media_enabled: room.media_enabled,
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
