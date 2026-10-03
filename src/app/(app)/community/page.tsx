import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { requireOnboarded } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";

export const metadata = { title: "Community — Steadfast" };

export default async function CommunityPage() {
  await requireOnboarded();
  const dict = await getDictionary();

  const supabase = await createClient();
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, slug, title, description, is_private")
    .order("title");

  return (
    <main className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.community.title}
        </h1>
        <p className="text-sm text-muted">{dict.community.listIntro}</p>
      </header>

      <ul className="flex flex-col gap-3">
        {(rooms ?? []).map((room) => (
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

      {rooms?.length === 0 && (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted">
          {dict.community.noRoomsYet}
        </p>
      )}
    </main>
  );
}