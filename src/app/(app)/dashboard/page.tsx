import { signOut } from "@/app/actions/auth";
import { CheckinCard } from "@/components/dashboard/checkin-card";
import { PanicButton } from "@/components/panic/panic-button";
import { StreakCard } from "@/components/dashboard/streak-card";
import { TaskList } from "@/components/dashboard/task-list";
import { WeeklyStrip } from "@/components/dashboard/weekly-strip";
import { getRecentCheckins, getTodayTasks, requireOnboarded } from "@/lib/dal";
import { localDayKey } from "@/lib/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { getDictionary } from "@/lib/i18n/server";

/** The seven day-keys ending today, oldest first. */
function lastSevenDays(today: string): string[] {
  const base = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getTime() - (6 - i) * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}

export default async function DashboardPage() {
  const profile = await requireOnboarded();

  const [tasks, checkins, dict] = await Promise.all([
    getTodayTasks(),
    getRecentCheckins(7),
    getDictionary(),
  ]);

  const today = localDayKey(profile.timezone, profile.day_cutoff_hour);
  const days = lastSevenDays(today);
  const todayCheckin = checkins.find((c) => c.day_key === today) ?? null;
  const firstName = profile.display_name?.split(" ")[0] ?? dict.dashboard.friend;

  return (
    <main className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting(profile.timezone, dict)}, {firstName}
        </h1>
        <p className="text-sm text-muted">
          {todayCheckin ? dict.dashboard.checkedInToday : dict.dashboard.notCheckedIn}
        </p>
      </header>

      <div className="grid w-full gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-6">
          <StreakCard profile={profile} />
          <TaskList initialTasks={tasks} />
          <PanicButton />
        </div>

        <div className="flex flex-col gap-6">
          <WeeklyStrip
            checkins={checkins}
            days={days}
            weeklyGoal={profile.weekly_goal}
          />
          <CheckinCard
            today={today}
            mood={todayCheckin?.mood ?? null}
            urgeLevel={todayCheckin?.urge_level ?? null}
            note={todayCheckin?.note ?? null}
          />
        </div>
      </div>

      {/* Sign-out stays available on narrow screens, where the sidebar footer is
          hidden and the sidebar itself is a horizontal strip. */}
      <form action={signOut} className="lg:hidden">
        <button
          type="submit"
          className="w-full rounded-xl border border-line px-3 py-2.5 text-sm text-muted transition hover:border-line-strong hover:text-ink"
        >
          {dict.common.signOut}
        </button>
      </form>
    </main>
  );
}

/** Greets in the member's own timezone, not the server's. */
function greeting(timezone: string, dict: Dictionary): string {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
    );
    if (hour < 12) return dict.dashboard.greetingMorning;
    if (hour < 18) return dict.dashboard.greetingAfternoon;
    return dict.dashboard.greetingEvening;
  } catch {
    return dict.dashboard.greetingFallback;
  }
}