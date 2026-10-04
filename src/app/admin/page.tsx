import Link from "next/link";

import { AlertActions } from "@/components/admin/admin-actions";
import { Badge, EmptyNote, Section } from "@/components/admin/dossier-ui";
import { requireStaff } from "@/lib/dal";
import {
  alertSeverityLabel,
  alertSourceLabel,
  panicLabel,
  relativeTime,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import { authEmailToPhone, formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { interpolate } from "@/lib/i18n/interpolate";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import type { PanicAlert } from "@/lib/types";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: { absolute: `${dict.console.overview} · ${dict.console.title}` } };
}

type Stats = {
  users: { total: number; active_7d: number; suspended: number };
  streaks: { avg: number; max: number; over_30: number; at_risk_7d: number };
  jobs: { open: number; total: number; flagged: number };
  moderation: {
    last_24h: number;
    blocked_24h: number;
    block_rate_pct: number;
    avg_latency_ms: number;
  };
  sos: { open: number; last_24h: number };
};

export default async function AdminOverviewPage() {
  await requireStaff();
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);

  const supabase = await createClient();
  const { data: stats } = await supabase.rpc("get_admin_stats");

  const { data: alerts } = await supabase
    .from("panic_alerts")
    .select(
      "id, user_id, day_key, source, message, urge_level, ai_response, status, severity, acknowledged_at, created_at",
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(25);

  // One extra round trip labels the whole feed. Staff can read every profile,
  // and selecting `email` (never `phone`) keeps this working both before and
  // after 0003: for phone accounts the number is encoded in the synthetic
  // auth address, which is where the directory reads it from too.
  const senderIds = Array.from(
    new Set(((alerts ?? []) as PanicAlert[]).map((row) => row.user_id)),
  );
  const senders = new Map<
    string,
    { id: string; display_name: string | null; email: string | null }
  >();
  if (senderIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", senderIds);
    for (const row of data ?? []) senders.set(row.id, row);
  }

  const s = (stats ?? null) as Stats | null;

  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{dict.console.overview}</h1>
        <p className="text-sm text-muted">{dict.console.overviewIntro}</p>
      </header>

      {!s ? (
        <p className="rounded-2xl border border-dashed p-6 text-sm text-muted">
          {dict.admin.statsUnavailable}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label={dict.admin.openSos}
            value={s.sos.open}
            tone={s.sos.open > 0 ? "danger" : "default"}
          />
          <Stat label={dict.admin.members} value={s.users.total} />
          <Stat label={dict.admin.active7d} value={s.users.active_7d} />
          <Stat
            label={dict.admin.atRisk}
            value={s.streaks.at_risk_7d}
            tone={s.streaks.at_risk_7d > 0 ? "warning" : "default"}
          />
          <Stat label={dict.admin.blocked24h} value={s.moderation.blocked_24h} />
          <Stat
            label={dict.admin.blockRate}
            value={`${s.moderation.block_rate_pct}%`}
          />
          <Stat
            label={dict.admin.modLatency}
            value={`${s.moderation.avg_latency_ms}ms`}
          />
          <Stat label={dict.admin.avgStreak} value={s.streaks.avg} />
        </div>
      )}

      <Section title={dict.admin.openAlerts} count={alerts?.length ?? 0}>
        {(alerts ?? []).length === 0 ? (
          <EmptyNote>{dict.admin.noOpenAlerts}</EmptyNote>
        ) : (
          <ul className="flex flex-col gap-2">
            {((alerts ?? []) as PanicAlert[]).map((alert) => {
              const sender = senders.get(alert.user_id);
              const phone = authEmailToPhone(sender?.email);
              const shownPhone = phone ? formatPhone(phone) : "";

              return (
                <li
                  key={alert.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-xl border p-3",
                    alert.severity === "critical"
                      ? "border-danger/40 bg-danger-soft/40"
                      : "border-line",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={alert.severity === "critical" ? "danger" : "warning"}
                    >
                      {alertSeverityLabel(alert.severity, dict)}
                    </Badge>
                    <span className="text-sm font-semibold">
                      {interpolate(dict.admin.urgeSummary, {
                        level: alert.urge_level ?? "?",
                        label: panicLabel(alert.urge_level, dict),
                      })}
                    </span>
                    <time
                      className="ms-auto text-xs text-faint"
                      dateTime={alert.created_at}
                    >
                      {relativeTime(alert.created_at, dict, locale)}
                    </time>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/users/${alert.user_id}`}
                      className="text-sm font-semibold hover:text-accent"
                    >
                      {sender?.display_name ?? dict.admin.unnamed}
                    </Link>
                    {phone ? (
                      <a
                        href={`tel:${phone}`}
                        dir="ltr"
                        aria-label={interpolate(dict.admin.callMember, {
                          phone: shownPhone,
                        })}
                        className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold text-accent transition hover:bg-accent/20"
                      >
                        {shownPhone}
                      </a>
                    ) : (
                      sender?.email && (
                        <span dir="ltr" className="text-xs text-faint">
                          {sender.email}
                        </span>
                      )
                    )}
                  </div>

                  {alert.message && (
                    <p className="text-sm leading-relaxed text-muted">{alert.message}</p>
                  )}

                  <p className="text-xs text-faint">
                    {interpolate(dict.admin.sourceAndDay, {
                      source: alertSourceLabel(alert.source, dict),
                      day: alert.day_key,
                    })}
                  </p>

                  <AlertActions alertId={alert.id} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "danger" | "warning";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-2xl border p-4",
        tone === "danger" && "border-danger/40 bg-danger-soft/40",
        tone === "warning" && "border-warning/40 bg-warning/10",
        tone === "default" && "bg-surface",
      )}
    >
      <span className="text-[11px] uppercase tracking-wide text-faint">{label}</span>
      <span
        className={cn(
          "text-xl font-semibold",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </span>
    </div>
  );
}