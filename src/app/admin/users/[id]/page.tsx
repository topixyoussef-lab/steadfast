import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ClearAllNotificationsActions,
  DeleteAccountActions,
  LogRowActions,
  MessageActions,
  NotificationActions,
  RoleActions,
  SuspensionActions,
} from "@/components/admin/admin-actions";
import {
  Badge,
  EmptyNote,
  Field,
  FieldList,
  Section,
  StatGrid,
} from "@/components/admin/dossier-ui";
import { BackIcon } from "@/components/icons";
import { getUserDossier, type Dossier } from "@/lib/admin-dal";
import { requireStaff } from "@/lib/dal";
import {
  alertSeverityLabel,
  alertSourceLabel,
  alertStatusLabel,
  applicationStatusLabel,
  categoryLabel,
  formatDate,
  formatMoney,
  jobStatusLabel,
  moderationStatusLabel,
  moodLabel,
  notificationTypeLabel,
  providerLabel,
  relativeTime,
  roleLabel,
  stageLabel,
  urgeLabel,
} from "@/lib/format";
import { interpolate } from "@/lib/i18n/interpolate";
import { authEmailToPhone, formatPhone } from "@/lib/phone";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/config";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.common.member };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // The layout already guards this; repeating it here means the page is safe
  // even if it is ever rendered outside the console shell. The result is kept
  // because the danger zone below needs to know who is looking at it.
  const staff = await requireStaff();

  // Anything that is not a uuid would be handed straight to PostgREST as a
  // parameter, and a bad value is a 400 rather than a 404.
  if (!UUID.test(id)) notFound();

  const [dict, locale, result] = await Promise.all([
    getDictionary(),
    getLocale(),
    getUserDossier(id),
  ]);

  if (result.status === "missing") notFound();

  if (result.status === "unavailable") {
    return (
      <main className="flex w-full flex-col gap-4 px-4 py-6 lg:px-8 lg:py-8">
        <BackLink dict={dict} />
        <p className="rounded-2xl border border-dashed p-6 text-sm text-muted">
          {dict.admin.user.unavailable}
        </p>
      </main>
    );
  }

  const { dossier } = result;
  const p = dossier.profile;
  const u = dict.admin.user;
  const dash = u.notAvailable;
  const memberPhone =
    formatPhone(dossier.auth.phone ?? p.phone ?? authEmailToPhone(p.email)) || dash;

  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">
      <BackLink dict={dict} />

      <header className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">
          {p.display_name ?? dict.admin.unnamed}
        </h1>
        {p.role !== "user" && <Badge tone="accent">{roleLabel(p.role, dict)}</Badge>}
        {dossier.is_suspended && <Badge tone="danger">{dict.admin.suspendedBadge}</Badge>}
      </header>

      <div className="grid w-full items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Identity and configuration, held in a sticky rail on wide screens. */}
        <div className="order-2 flex flex-col gap-4 xl:order-1 xl:col-start-2">
          <Section title={u.account}>
            <FieldList>
              <Field
                label={u.phone}
                value={
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    <span className="break-all">{memberPhone}</span>
                    {dossier.auth.phone_confirmed_at ? (
                      <Badge tone="good">{u.phoneConfirmed}</Badge>
                    ) : memberPhone !== dash ? (
                      <Badge tone="warning">{u.phoneNotConfirmed}</Badge>
                    ) : null}
                  </span>
                }
              />
              <Field
                label={u.authAccountCreated}
                value={formatDate(dossier.auth.created_at, locale, true)}
              />
              <Field
                label={u.lastSignIn}
                value={
                  dossier.auth.last_sign_in_at
                    ? formatDate(dossier.auth.last_sign_in_at, locale, true)
                    : u.neverSignedIn
                }
              />
              <Field
                label={u.phoneConfirmedOn}
                value={formatDate(dossier.auth.phone_confirmed_at, locale, true)}
              />
              <Field label={u.memberSince} value={formatDate(p.created_at, locale)} />
              <Field label={u.profileUpdated} value={formatDate(p.updated_at, locale, true)} />
              <Field
                label={u.signInMethod}
                value={
                  dossier.auth.provider ? providerLabel(dossier.auth.provider, dict) : dash
                }
              />
              {dossier.auth.banned_until && (
                <Field
                  label={u.bannedUntilLabel}
                  value={formatDate(dossier.auth.banned_until, locale, true)}
                />
              )}
            </FieldList>
          </Section>

          <Section title={u.profile}>
            <FieldList>
              <Field label={u.displayName} value={p.display_name ?? dash} />
              <Field label={dict.admin.role} value={<Badge>{roleLabel(p.role, dict)}</Badge>} />
              <Field
                label={u.background}
                value={
                  p.preference_type
                    ? dict.preferences[p.preference_type as keyof typeof dict.preferences]
                    : dash
                }
              />
              <Field label={u.recoveryStage} value={stageLabel(p.recovery_stage, dict)} />
              <Field label={u.timezone} value={p.timezone} />
              <Field
                label={u.dayCutoff}
                value={interpolate(u.dayCutoffValue, { n: p.day_cutoff_hour })}
              />
              <Field
                label={u.weeklyGoal}
                value={interpolate(u.streakDays, { n: p.weekly_goal })}
              />
              <Field label={u.trustScore} value={p.trust_score} />
              <Field label={u.cleanSince} value={formatDate(p.clean_since, locale)} />
              <Field label={u.lastActive} value={formatDate(p.last_active_day, locale)} />
              <Field
                label={u.onboarding}
                value={
                  p.onboarding_done ? (
                    <Badge tone="good">{u.onboarded}</Badge>
                  ) : (
                    <Badge tone="warning">{u.onboardingPending}</Badge>
                  )
                }
              />
              <Field
                label={u.currentStreak}
                value={interpolate(u.streakDays, { n: p.current_streak })}
              />
              <Field
                label={u.longestStreak}
                value={interpolate(u.streakDays, { n: p.highest_streak })}
              />
            </FieldList>
          </Section>

          <Section title={dict.admin.role}>
            <div className="flex flex-col gap-3">
              <RoleActions userId={p.id} role={p.role} />
              <SuspensionActions userId={p.id} suspended={dossier.is_suspended} />
            </div>
          </Section>

          {/* Bottom of the rail on purpose: this is the one control here that
              cannot be undone, so it should not sit next to a role toggle.
              Hidden on your own dossier because the action refuses that, and a
              permanently failing button is worse than no button. Moderators
              still see it and get the server's "only admins" reason inline,
              same as RoleActions. */}
          {staff.id !== p.id && (
            <Section title={dict.admin.dangerZone} className="border-danger/40">
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted">{dict.admin.deleteAccountWarning}</p>
                <DeleteAccountActions
                  userId={p.id}
                  displayName={p.display_name ?? dict.admin.unnamed}
                />
              </div>
            </Section>
          )}
        </div>

        {/* Everything the member actually did. */}
        <div className="order-1 flex flex-col gap-4 xl:order-2 xl:col-start-1 xl:row-start-1">
          <StatGrid
            tiles={[
              { label: u.checkins, value: dossier.stats.checkins_total },
              { label: u.checkins30d, value: dossier.stats.checkins_30d },
              { label: u.avgMood, value: dossier.stats.avg_mood ?? dash },
              { label: u.avgUrge, value: dossier.stats.avg_urge ?? dash },
              {
                label: u.lastCheckin,
                value: dossier.stats.last_checkin_day ?? dash,
              },
              { label: u.tasksDone, value: dossier.stats.tasks_done },
              { label: u.tasksDone30d, value: dossier.stats.tasks_done_30d },
              { label: u.activeDays, value: dossier.stats.active_days },
              { label: u.currentStreak, value: p.current_streak },
              { label: u.longestStreak, value: p.highest_streak },
              { label: u.jobsPosted, value: dossier.stats.jobs_posted },
              { label: u.jobsOpen, value: dossier.stats.jobs_open },
              { label: u.appsSent, value: dossier.stats.apps_made },
              { label: u.appsReceived, value: dossier.stats.apps_received },
              { label: u.messages, value: dossier.stats.messages },
              {
                label: u.messagesFlagged,
                value: dossier.stats.messages_flagged,
                tone: dossier.stats.messages_flagged > 0 ? "warning" : "default",
              },
              {
                label: u.messagesBlocked,
                value: dossier.stats.messages_blocked,
                tone: dossier.stats.messages_blocked > 0 ? "danger" : "default",
              },
              { label: u.messagesDeleted, value: dossier.stats.messages_deleted },
              { label: u.sosTotal, value: dossier.stats.panic_total },
              {
                label: u.sosOpen,
                value: dossier.stats.panic_open,
                tone: dossier.stats.panic_open > 0 ? "danger" : "default",
              },
              {
                label: u.sos24h,
                value: dossier.stats.panic_24h,
                tone: dossier.stats.panic_24h > 0 ? "danger" : "default",
              },
              { label: u.notificationsUnread, value: dossier.stats.notifications_unread },
            ]}
            columns={3}
          />

          <CheckinHistory rows={dossier} dict={dict} />
          <SosHistory rows={dossier} dict={dict} locale={locale} />
          <ChatHistory rows={dossier} dict={dict} locale={locale} />
          <ModerationHistory rows={dossier} dict={dict} locale={locale} />
          <TaskHistory rows={dossier} dict={dict} />
          <JobsHistory rows={dossier} dict={dict} locale={locale} />
          <ApplicationsHistory rows={dossier} dict={dict} locale={locale} />
          <NotificationHistory rows={dossier} dict={dict} locale={locale} />
        </div>
      </div>
    </main>
  );
}

function BackLink({ dict }: { dict: Dictionary }) {
  return (
    <Link
      href="/admin/members"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted transition hover:text-ink"
    >
      <BackIcon className="h-4 w-4 rtl:rotate-180" />
      {dict.admin.user.backToMembers}
    </Link>
  );
}

function CheckinHistory({ rows, dict }: { rows: Dossier; dict: Dictionary }) {
  const u = dict.admin.user;

  return (
    <Section title={u.checkinHistory} count={rows.checkins.length}>
      {rows.checkins.length === 0 ? (
        <EmptyNote>{u.empty}</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-start text-xs text-faint">
                <th className="py-1.5 pe-3 text-start font-medium">{u.day}</th>
                <th className="py-1.5 pe-3 text-start font-medium">{u.mood}</th>
                <th className="py-1.5 pe-3 text-start font-medium">{u.urge}</th>
                <th className="py-1.5 text-start font-medium">{u.note}</th>
              </tr>
            </thead>
            <tbody>
              {rows.checkins.map((row) => (
                <tr key={row.day_key} className="border-b border-line/50 last:border-0">
                  <td className="whitespace-nowrap py-2 pe-3 text-muted">{row.day_key}</td>
                  <td className="whitespace-nowrap py-2 pe-3">
                    {row.mood ?? "—"}
                    <span className="ms-1 text-xs text-faint">
                      {moodLabel(row.mood, dict)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-2 pe-3">
                    {row.urge_level ?? "—"}
                    <span className="ms-1 text-xs text-faint">
                      {urgeLabel(row.urge_level, dict)}
                    </span>
                  </td>
                  <td className="py-2 text-muted">{row.note ?? dict.admin.user.notAvailable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function TaskHistory({ rows, dict }: { rows: Dossier; dict: Dictionary }) {
  const u = dict.admin.user;

  return (
    <Section title={u.taskHistory} count={rows.task_completions.length}>
      {rows.task_completions.length === 0 ? (
        <EmptyNote>{u.empty}</EmptyNote>
      ) : (
        <ul className="flex flex-col divide-y divide-line/50">
          {rows.task_completions.map((row, i) => (
            <li
              key={`${row.completed_at}-${i}`}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2"
            >
              <span className="min-w-0 text-sm">{row.title}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-faint">
                <Badge>{categoryLabel(row.category, dict)}</Badge>
                <span>{interpolate(u.minutesShort, { n: row.estimated_minutes })}</span>
                <span>{row.day_key}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function SosHistory({
  rows,
  dict,
  locale,
}: {
  rows: Dossier;
  dict: Dictionary;
  locale: Locale;
}) {
  const u = dict.admin.user;

  return (
    <Section title={u.sosHistory} count={rows.panic_alerts.length}>
      {rows.panic_alerts.length === 0 ? (
        <EmptyNote>{u.empty}</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.panic_alerts.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-1.5 rounded-xl border border-line p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    row.severity === "critical"
                      ? "danger"
                      : row.severity === "warning"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {alertSeverityLabel(row.severity, dict)}
                </Badge>
                <Badge tone={row.status === "open" ? "warning" : "neutral"}>
                  {alertStatusLabel(row.status, dict)}
                </Badge>
                <span className="text-xs text-faint">
                  {u.source}: {alertSourceLabel(row.source, dict)} · {row.day_key}
                </span>
                <time className="ms-auto text-xs text-faint" dateTime={row.created_at}>
                  {relativeTime(row.created_at, dict, locale)}
                </time>
              </div>

              <p className="text-sm">
                {u.urge}: {row.urge_level ?? "—"} · {urgeLabel(row.urge_level, dict)}
              </p>

              {row.message && <p className="text-sm text-muted">{row.message}</p>}

              {row.ai_response && (
                <p className="rounded-lg bg-sunken p-2 text-xs leading-relaxed text-muted">
                  <span className="font-medium text-ink">{u.aiResponse}: </span>
                  {row.ai_response}
                </p>
              )}

              {row.acknowledged_at && (
                <p className="text-[11px] text-faint">
                  {dict.admin.resolve}: {formatDate(row.acknowledged_at, locale, true)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ChatHistory({
  rows,
  dict,
  locale,
}: {
  rows: Dossier;
  dict: Dictionary;
  locale: Locale;
}) {
  const u = dict.admin.user;

  return (
    <Section title={u.chatHistory} count={rows.chat_messages.length}>
      {rows.chat_messages.length === 0 ? (
        <EmptyNote>{u.empty}</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.chat_messages.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-1.5 rounded-xl border border-line p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    row.moderation_status === "blocked"
                      ? "danger"
                      : row.moderation_status === "flagged"
                        ? "warning"
                        : "good"
                  }
                >
                  {moderationStatusLabel(row.moderation_status, dict)}
                </Badge>
                {row.is_flagged_by_ai && <Badge tone="warning">{u.aiChecked}</Badge>}
                {row.deleted_at && <Badge tone="neutral">{dict.admin.remove}</Badge>}
                <span className="text-xs text-faint">{row.room_title ?? row.room_slug}</span>
                <time className="ms-auto text-xs text-faint" dateTime={row.created_at}>
                  {relativeTime(row.created_at, dict, locale)}
                </time>
              </div>
              <p className="text-sm leading-relaxed">{row.content}</p>
              <MessageActions messageId={row.id} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ModerationHistory({
  rows,
  dict,
  locale,
}: {
  rows: Dossier;
  dict: Dictionary;
  locale: Locale;
}) {
  const u = dict.admin.user;

  return (
    <Section title={u.moderationHistory} count={rows.moderation_log.length}>
      {rows.moderation_log.length === 0 ? (
        <EmptyNote>{u.empty}</EmptyNote>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.moderation_log.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-1.5 rounded-xl border border-line p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={row.status === "blocked" ? "danger" : "warning"}
                >
                  {moderationStatusLabel(row.status, dict)}
                </Badge>
                <Badge tone="neutral">{alertSeverityLabel(row.severity, dict)}</Badge>
                {row.latency_ms !== null && (
                  <span className="text-xs text-faint">
                    {interpolate(u.latencyMs, { n: row.latency_ms })}
                  </span>
                )}
                <time className="ms-auto text-xs text-faint" dateTime={row.created_at}>
                  {relativeTime(row.created_at, dict, locale)}
                </time>
              </div>

              {row.content_preview && (
                <p className="text-sm text-muted">{row.content_preview}</p>
              )}

              {(row.categories.length > 0 || row.matched_terms.length > 0) && (
                <p className="text-xs text-faint">
                  {u.matchedTerms}:{" "}
                  {[...row.categories, ...row.matched_terms].join("، ")}
                </p>
              )}
              <LogRowActions logId={String(row.id)} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function JobsHistory({
  rows,
  dict,
  locale,
}: {
  rows: Dossier;
  dict: Dictionary;
  locale: Locale;
}) {
  const u = dict.admin.user;

  return (
    <Section title={u.jobsHistory} count={rows.jobs.length}>
      {rows.jobs.length === 0 ? (
        <EmptyNote>{u.empty}</EmptyNote>
      ) : (
        <ul className="flex flex-col divide-y divide-line/50">
          {rows.jobs.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2"
            >
              <Link href={`/jobs/${row.id}`} className="min-w-0 text-sm hover:underline">
                {row.title}
              </Link>
              <span className="flex shrink-0 items-center gap-2 text-xs text-faint">
                <Badge
                  tone={row.status === "open" ? "good" : "neutral"}
                >
                  {jobStatusLabel(row.status, dict)}
                </Badge>
                {row.is_ai_clean && <Badge tone="good">{u.aiChecked}</Badge>}
                <span>
                  {u.price}:{" "}
                  {formatMoney(row.price_minor, row.currency, row.price_type, dict, locale)}
                </span>
                <span>
                  {u.applications}: {row.applications_count}
                </span>
                <span>{formatDate(row.created_at, locale)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ApplicationsHistory({
  rows,
  dict,
  locale,
}: {
  rows: Dossier;
  dict: Dictionary;
  locale: Locale;
}) {
  const u = dict.admin.user;

  return (
    <Section title={u.applicationsHistory} count={rows.job_applications.length}>
      {rows.job_applications.length === 0 ? (
        <EmptyNote>{u.empty}</EmptyNote>
      ) : (
        <ul className="flex flex-col divide-y divide-line/50">
          {rows.job_applications.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2"
            >
              <span className="min-w-0 text-sm">{row.job_title}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-faint">
                <Badge tone="neutral">{applicationStatusLabel(row.status, dict)}</Badge>
                <span>{formatDate(row.created_at, locale)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function NotificationHistory({
  rows,
  dict,
  locale,
}: {
  rows: Dossier;
  dict: Dictionary;
  locale: Locale;
}) {
  const u = dict.admin.user;

  return (
    <Section
      title={u.notificationHistory}
      count={rows.notifications.length}
      // Clear-all only when there is something to clear, and it sits in the
      // header so it is not mistaken for a per-row control.
      action={
        rows.notifications.length > 0 ? (
          <ClearAllNotificationsActions
            userId={rows.profile.id}
            count={rows.notifications.length}
          />
        ) : null
      }
    >
      {rows.notifications.length === 0 ? (
        <EmptyNote>{u.empty}</EmptyNote>
      ) : (
        <ul className="flex flex-col divide-y divide-line/50">
          {rows.notifications.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Badge tone={row.read_at ? "neutral" : "accent"}>
                  {notificationTypeLabel(row.type, dict)}
                </Badge>
                <span className="truncate text-sm">{row.title}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <time className="text-xs text-faint" dateTime={row.created_at}>
                  {relativeTime(row.created_at, dict, locale)}
                </time>
                <NotificationActions notificationId={row.id} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}