import { requireStaff } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import { WatchBind } from "@/components/admin/watch-bind";

export async function generateMetadata() {
  const dict = await getDictionary();
  return { title: dict.console.watch };
}

type DayRow = { day: string; blocked: number; allowed: number };

type ConsentRow = {
  user_id: string;
  status: string | null;
  consented_at: string | null;
};

type MemberLite = { id: string; display_name: string | null };

export default async function AdminWatchPage() {
  await requireStaff();
  const dict = await getDictionary();
  const supabase = await createClient();

  // admin_watch_report (0011) returns nothing for a member without an active
  // consent, so this page can only ever show the rows the reporting itself
  // trusts — there is no way to ask the console for someone silently.
  const { data: consents } = await supabase
    .from("monitoring_consents")
    .select("user_id, status, consented_at")
    .eq("status", "active")
    .order("consented_at", { ascending: false })
    .limit(50);

  const { data: members } = await supabase.rpc("get_admin_members", {
    p_limit: 200,
  });

  const consentList = (consents ?? []) as ConsentRow[];
  const nameOf = new Map(
    ((members ?? []) as MemberLite[]).map((member) => [
      member.id,
      member.display_name ?? dict.admin.unnamed,
    ]),
  );

  const rows: Array<{
    id: string;
    name: string;
    consentedAt: string | null;
    totals: { blocked: number; allowed: number };
    days: DayRow[];
  }> = [];

  for (const consent of consentList) {
    const { data } = await supabase.rpc("admin_watch_report", {
      p_user_id: consent.user_id,
      p_days: 14,
    });

    const days = ((data ?? []) as DayRow[]).map((row) => ({
      ...row,
      blocked: Number(row.blocked),
      allowed: Number(row.allowed),
    }));

    const totals = days.reduce<{ blocked: number; allowed: number }>(
      (acc, row) => ({
        blocked: acc.blocked + row.blocked,
        allowed: acc.allowed + row.allowed,
      }),
      { blocked: 0, allowed: 0 },
    );

    rows.push({
      id: consent.user_id,
      name: nameOf.get(consent.user_id) ?? dict.admin.unnamed,
      consentedAt: consent.consented_at,
      totals,
      days,
    });
  }

  return (
    <main className="flex w-full flex-col gap-5 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.console.watch}
        </h1>
        <p className="text-sm text-muted">{dict.console.watchIntro}</p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-4 text-sm text-muted">
          {dict.admin.watchEmpty}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((row) => (
            <section
              key={row.id}
              className="flex flex-col gap-3 rounded-2xl border bg-surface p-4"
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">{row.name}</h2>
                <div className="flex items-center gap-3 text-xs text-muted">
                  {row.consentedAt && (
                    <span>
                      {dict.admin.watchSinceLabel}{" "}
                      {new Date(row.consentedAt).toLocaleDateString()}
                    </span>
                  )}
                  <span className="text-accent">
                    {dict.admin.watchBlocked} {row.totals.blocked}
                  </span>
                  <span>
                    {dict.admin.watchAllowed} {row.totals.allowed}
                  </span>
                </div>
              </header>

              {row.days.length === 0 ? (
                <p className="text-xs text-faint">{dict.admin.watchNothing}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {row.days.map((day) => (
                    <div
                      key={day.day}
                      className="flex items-center justify-between rounded-xl bg-sunken px-3 py-2 text-xs"
                    >
                      <span className="text-muted">{day.day}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-danger">{day.blocked}</span>
                        <span className="text-accent">{day.allowed}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <WatchBind memberId={row.id} memberName={row.name} />
            </section>
          ))}
        </div>
      )}
    </main>
  );
}