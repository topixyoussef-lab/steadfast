import type { CheckinRow } from "@/lib/dal";
import { moodLabel, urgeLabel, weekdayInitial } from "@/lib/format";
import { cn } from "@/lib/cn";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/interpolate";

type Props = {
  checkins: CheckinRow[];
  days: string[];
  weeklyGoal: number;
};

/**
 * Seven-day strip. The seven slots are generated from the member's own
 * timezone and cutoff hour in the page, so "today" lands in the same place
 * the database puts it, then filled from their check-in rows.
 */
export async function WeeklyStrip({ checkins, days, weeklyGoal }: Props) {
  const [dict, locale] = await Promise.all([getDictionary(), getLocale()]);
  const byDay = new Map(checkins.map((c) => [c.day_key, c]));

  const done = days.filter((d) => byDay.has(d)).length;
  const met = done >= weeklyGoal;

  return (
    <section
      className="rounded-3xl border bg-surface p-5 shadow-sm"
      aria-labelledby="week-heading"
    >
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 id="week-heading" className="text-base font-semibold">
          {dict.week.lastSeven}
        </h2>
        <p className={cn("text-sm", met ? "text-accent" : "text-muted")}>
          {interpolate(dict.week.checkIns, { done, goal: weeklyGoal })}
        </p>
      </header>

      <ol className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const checkin = byDay.get(day);
          const isToday = day === days[days.length - 1];

          return (
            <li key={day} className="flex flex-col items-center gap-1.5">
              <span className="text-xs font-medium text-faint" aria-hidden="true">
                {weekdayInitial(day, locale)}
              </span>
              <div
                title={
                  checkin
                    ? interpolate(dict.week.dayTitle, {
                        mood: moodLabel(checkin.mood, dict),
                        urge: urgeLabel(checkin.urge_level, dict),
                      })
                    : dict.week.noCheckin
                }
                className={cn(
                  "flex size-10 items-center justify-center rounded-xl border text-sm font-semibold",
                  checkin && "border-accent/40 bg-accent-soft text-accent",
                  !checkin && "border-line bg-sunken text-faint",
                  isToday && "ring-2 ring-accent/50",
                )}
              >
                {checkin ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="size-4"
                    aria-hidden="true"
                  >
                    <path
                      d="M20 6 9 17l-5-5"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span aria-hidden="true">·</span>
                )}
                <span className="sr-only">
                  {day}:{" "}
                  {checkin ? dict.week.checkedIn : dict.week.noCheckin}
                  {isToday ? dict.week.srToday : ""}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
