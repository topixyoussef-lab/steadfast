import { MessageActions } from "@/components/admin/admin-actions";
import { Badge, EmptyNote, Section } from "@/components/admin/dossier-ui";
import { requireStaff } from "@/lib/dal";
import { relativeTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export const metadata = { title: "Moderation — Steadfast Console" };

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

      <Section
        title={dict.admin.flaggedMessages}
        count={flagged?.length ?? 0}
        className="w-full"
      >
        {(flagged ?? []).length === 0 ? (
          <EmptyNote>{dict.admin.nothingToReview}</EmptyNote>
        ) : (
          <ul className="flex flex-col gap-2">
            {(flagged ?? []).map((message) => (
              <li key={message.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="warning">{message.moderation_status}</Badge>
                  <span className="ms-auto text-xs text-faint">
                    {relativeTime(message.created_at, dict, locale)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{message.content}</p>
                <MessageActions messageId={message.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={dict.admin.user.moderationHistory} count={log?.length ?? 0}>
        {(log ?? []).length === 0 ? (
          <EmptyNote>{dict.admin.user.empty}</EmptyNote>
        ) : (
          <ul className="flex flex-col divide-y divide-line/50">
            {(log ?? []).map((row) => (
              <li key={row.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.status === "blocked" ? "danger" : "warning"}>
                    {row.status}
                  </Badge>
                  <Badge tone="neutral">{row.severity}</Badge>
                  {row.latency_ms !== null && (
                    <span className="text-xs text-faint">{row.latency_ms}ms</span>
                  )}
                  <span className="ms-auto text-xs text-faint">
                    {relativeTime(row.created_at, dict, locale)}
                  </span>
                </div>
                {row.content_preview && (
                  <p className="text-sm text-muted">{row.content_preview}</p>
                )}
                {row.matched_terms?.length > 0 && (
                  <p className="text-xs text-faint">
                    {dict.admin.user.matchedTerms}: {row.matched_terms.join("، ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}