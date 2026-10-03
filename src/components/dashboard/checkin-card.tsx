"use client";

import { useActionState, useState } from "react";

import { recordCheckinAction, type CheckinState } from "@/app/actions/checkin";
import { moodLabel, urgeLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/components/i18n-provider";
import { FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

type Props = {
  today: string | null;
  mood: number | null;
  urgeLevel: number | null;
  note: string | null;
};

export function CheckinCard({ today, mood, urgeLevel, note }: Props) {
  const { dict } = useI18n();
  const t = dict.checkin;
  const [state, formAction] = useActionState<CheckinState, FormData>(
    recordCheckinAction,
    {},
  );

  const [moodValue, setMoodValue] = useState(mood ?? 7);
  const [urgeValue, setUrgeValue] = useState(urgeLevel ?? 3);

  const justLogged = state.result !== undefined;

  return (
    <section
      className="rounded-3xl border bg-surface p-5 shadow-sm"
      aria-labelledby="checkin-heading"
    >
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="checkin-heading" className="text-base font-semibold">
          {t.title}
        </h2>
        {today && (
          <p className="text-sm text-muted">
            {justLogged ? t.savedToday : t.onceADay}
          </p>
        )}
      </header>

      {justLogged && state.result && (
        <p
          role="status"
          className="mb-4 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent"
        >
          {state.result.current_streak} {t.logged}
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="mood" className="text-sm font-medium text-muted">
              {t.moodQuestion}
            </label>
            <span className="text-sm text-accent">{moodLabel(moodValue, dict)}</span>
          </div>
          <input
            id="mood"
            name="mood"
            type="range"
            min={1}
            max={10}
            step={1}
            value={moodValue}
            onChange={(e) => setMoodValue(Number(e.target.value))}
            aria-valuetext={moodLabel(moodValue, dict)}
            className="h-2 w-full appearance-none rounded-full bg-sunken accent-accent"
          />
          <div className="flex justify-between text-[11px] text-faint">
            <span>{t.moodMin}</span>
            <span>{t.moodMax}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="urgeLevel" className="text-sm font-medium text-muted">
              {t.urgeQuestion}
            </label>
            <span className={cn(urgeValue >= 7 ? "text-warning" : "text-accent")}>
              {urgeLabel(urgeValue, dict)}
            </span>
          </div>
          <input
            id="urgeLevel"
            name="urgeLevel"
            type="range"
            min={0}
            max={10}
            step={1}
            value={urgeValue}
            onChange={(e) => setUrgeValue(Number(e.target.value))}
            aria-valuetext={urgeLabel(urgeValue, dict)}
            className="h-2 w-full appearance-none rounded-full bg-sunken accent-accent"
          />
          <div className="flex justify-between text-[11px] text-faint">
            <span>{t.urgeMin}</span>
            <span>{t.urgeMax}</span>
          </div>
          <FormError message={state.fieldErrors?.urgeLevel?.[0]} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="note" className="text-sm font-medium text-muted">
            {t.noteLabel}{" "}<span className="text-faint">({dict.common.optional})</span>
          </label>
          <textarea
            id="note"
            name="note"
            rows={3}
            maxLength={500}
            defaultValue={note ?? ""}
            placeholder={t.notePlaceholder}
            className="w-full resize-none rounded-xl border border-line bg-sunken px-4 py-3 text-base leading-relaxed focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
          />
          <FormError message={state.fieldErrors?.note?.[0]} />
        </div>

        <FormError message={state.error} />
        <SubmitButton pendingLabel={t.pending}>{t.submit}</SubmitButton>
      </form>
    </section>
  );
}
