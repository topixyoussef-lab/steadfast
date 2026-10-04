import Link from "next/link";

import { MarkReadButton } from "@/components/notifications/mark-read-button";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/dal";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import type { Notification } from "@/lib/types";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.notifications.title };
}

export default async function NotificationsPage() {
  await requireProfile();
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);

  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, type, title, body, link, metadata, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  const notifications = (data ?? []) as Notification[];
  const unread = notifications.filter((n) => !n.read_at);

  return (
    <main className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{dict.notifications.title}</h1>
          <p className="text-sm text-muted">
            {unread.length > 0
              ? interpolate(dict.notifications.unreadCount, { n: unread.length })
              : dict.notifications.allCaughtUp}
          </p>
        </div>
        {unread.length > 0 && <MarkReadButton />}
      </header>

      {notifications.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted">
          {dict.notifications.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((item) => (
            <li key={item.id}>
              <div
                className={cn(
                  "flex flex-col gap-1 rounded-2xl border p-4",
                  item.read_at ? "bg-surface" : "border-accent/30 bg-accent-soft/40",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">{item.title}</span>
                  <time className="shrink-0 text-[11px] text-faint" dateTime={item.created_at}>
                    {relativeTime(item.created_at, dict, locale)}
                  </time>
                </div>

                {item.body && (
                  <p className="text-sm leading-relaxed text-muted">{item.body}</p>
                )}

                {item.link && (
                  <Link href={item.link} className="text-sm text-accent hover:underline">
                    {dict.notifications.open}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}