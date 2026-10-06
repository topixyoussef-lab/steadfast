import { requireStaff } from "@/lib/dal";
import { ModerationConsole } from "@/components/admin/moderation-console";
import {
  WipeChatActions,
  WipeLogActions,
} from "@/components/admin/admin-actions";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.console.moderation };
}

export default async function AdminModerationPage() {
  const staff = await requireStaff();
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);

  const supabase = await createClient();

  // chat_messages is readable by any authenticated member of a public room, so
  // this needs no extra grant; moderation_log is admin-only by policy. The
  // head counts below target the same tables the wipes act on, so the panels
  // show the size of the block before it is freed.
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

  const { count: messageCount } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true });
  const { count: fileCount } = await supabase
    .from("chat_message_attachments")
    .select("storage_path", { count: "exact", head: true });
  const { count: logCount } = await supabase
    .from("moderation_log")
    .select("id", { count: "exact", head: true });

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

      {staff.role === "admin" ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-danger/40 bg-danger-soft/40 p-4">
          <h2 className="text-sm font-semibold text-ink">
            {dict.admin.maintenanceTitle}
          </h2>
          <p className="text-xs text-muted">{dict.admin.maintenanceIntro}</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-8">
            <WipeLogActions count={logCount ?? 0} />
            <WipeChatActions
              count={messageCount ?? 0}
              files={fileCount ?? 0}
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}