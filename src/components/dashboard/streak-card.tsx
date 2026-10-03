import {
  milestoneLabel,
  nextMilestone,
  progressToMilestone,
  stageBlurb,
  stageLabel,
} from "@/lib/format";
import { getDictionary } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/interpolate";
import type { Profile } from "@/lib/types";

export async function StreakCard({ profile }: { profile: Profile }) {
  const dict = await getDictionary();
  const streak = profile.current_streak;
  const next = nextMilestone(streak);
  const progress = progressToMilestone(streak);

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-accent/25 bg-surface p-6 shadow-sm"
      aria-labelledby="streak-heading"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-accent/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-5">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-muted">
              {dict.dashboard.currentStreak}
            </p>
            <h2 id="streak-heading" className="text-4xl font-semibold tracking-tight">
              {streak}
              <span className="ms-2 text-lg font-normal text-muted">
                {streak === 1 ? dict.dashboard.day : dict.dashboard.days}
              </span>
            </h2>
          </div>
          <span className="shrink-0 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            {stageLabel(profile.recovery_stage, dict)}
          </span>
        </header>

        <p className="text-sm leading-relaxed text-muted">
          {stageBlurb(profile.recovery_stage, dict)}
        </p>

        {next ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted">{dict.dashboard.nextMilestone}</span>
              <span className="font-medium text-ink">
                {milestoneLabel(next, dict)} ·{" "}
                {interpolate(dict.dashboard.toGo, { n: next - streak })}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={interpolate(dict.dashboard.progressToDay, { n: next })}
              className="h-2 w-full overflow-hidden rounded-full bg-sunken"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.max(progress, 4)}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-accent">{dict.dashboard.passedAllMilestones}</p>
        )}

        <dl className="grid grid-cols-2 gap-4 border-t border-line pt-4 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted">{dict.dashboard.bestStreak}</dt>
            <dd className="font-semibold">
              {profile.highest_streak} {dict.dashboard.days}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted">{dict.week.goal}</dt>
            <dd className="font-semibold">
              {profile.weekly_goal} {dict.dashboard.checkins}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}