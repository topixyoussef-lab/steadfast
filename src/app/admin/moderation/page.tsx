import { requireStaff } from "@/lib/dal";
import { ModerationConsole } from "@/components/admin/moderation-console";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.console.moderation };
}

export default async function AdminModerationPage() {
  await requireStaff();
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);

  const supabase = await createClient();

  // chat_messages is readable by any authenticated member of a public room, so
  // this needs no extra grant; moderation_log is admin-only by policy.
  const { data: flagged } = await supabase
    .from("chat_messages")
    .select("id, room_id, user_id, content, moderation_status, created_at")
    .eq("is_flagged_by_ai", true)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: log } = await supabase
    .from("moderation_log")
    .select(
      "id, user_id, room_id, content_preview, status, severity, categories, matched_terms, latency_ms, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.console.moderation}
        </h1>
        <p className="text-sm text-muted">{dict.console.moderationIntro}</p>
      </header>

      <ModerationConsole
        flagged={flagged ?? []}
        log={log ?? []}
        dict={dict}
        locale={locale}
      />
    </main>
  );
}
