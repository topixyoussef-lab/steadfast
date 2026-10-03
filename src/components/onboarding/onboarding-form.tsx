"use client";

import { useEffect } from "react";
import { useActionState } from "react";

import { completeOnboardingAction, type OnboardingState } from "@/app/actions/onboarding";
import { useI18n } from "@/components/i18n-provider";
import { interpolate } from "@/lib/i18n/interpolate";
import { PREFERENCES } from "@/lib/preferences";
import { Field, FormError } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function OnboardingForm() {
  const { dict } = useI18n();
  const [state, formAction] = useActionState<OnboardingState, FormData>(
    completeOnboardingAction,
    {},
  );

  useEffect(() => {
    if (typeof Intl === "undefined" || !Intl.DateTimeFormat) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const el = document.querySelector<HTMLInputElement>('input[name="timezone"]');
    if (el && !el.value) el.value = tz;
  }, []);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{dict.onboarding.choosePathTitle}</h2>
          <p className="text-sm text-muted">{dict.onboarding.choosePathBody}</p>
        </header>

        <div role="radiogroup" className="flex flex-col gap-3">
          {PREFERENCES.map((pref) => (
            <label
              key={pref.id}
              htmlFor={`pref-${pref.id}`}
              className="group relative flex cursor-pointer items-start gap-4 rounded-2xl border bg-surface p-4 shadow-sm shadow-black/10 transition hover:border-accent/60 has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent/25"
            >
              <input
                type="radio"
                id={`pref-${pref.id}`}
                name="preference"
                value={pref.id}
                required
                className="mt-1 size-4 accent-accent"
              />
              <div className="flex flex-col gap-1">
                <span className="text-base font-semibold">{pref.label(dict)}</span>
                <span className="text-sm text-muted">{pref.tagline(dict)}</span>
                <p className="mt-1 text-sm leading-relaxed text-ink/90">
                  {pref.description(dict)}
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {pref.sampleTasks(dict).map((task) => (
                    <li
                      key={task}
                      className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs text-accent"
                    >
                      {task}
                    </li>
                  ))}
                </ul>
              </div>
            </label>
          ))}
        </div>
        <FormError message={state.fieldErrors?.preference?.[0]} />
      </section>

      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{dict.onboarding.aboutYouTitle}</h2>
          <p className="text-sm text-muted">{dict.onboarding.aboutYouBody}</p>
        </header>

        <div className="flex flex-col gap-4">
          <Field
            label={dict.onboarding.nameLabel}
            name="displayName"
            placeholder={dict.onboarding.namePlaceholder}
            autoComplete="name"
            required
            minLength={2}
            errors={state.fieldErrors?.displayName}
          />
          <Field
            label={dict.onboarding.timezoneLabel}
            name="timezone"
            placeholder={dict.onboarding.timezonePlaceholder}
            autoComplete="off"
            required
            errors={state.fieldErrors?.timezone}
            hint={dict.onboarding.timezoneHint}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="weeklyGoal" className="text-sm font-medium text-muted">
              {dict.onboarding.weeklyGoalLabel}
            </label>
            <select
              id="weeklyGoal"
              name="weeklyGoal"
              defaultValue={5}
              required
              className="h-12 w-full rounded-xl border border-line bg-sunken px-4 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            >
              {[3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {interpolate(
                    n === 5 ? dict.onboarding.daysRecommended : dict.onboarding.daysCount,
                    { n },
                  )}
                </option>
              ))}
            </select>
            <p className="text-sm text-faint">{dict.onboarding.weeklyGoalHint}</p>
            <FormError message={state.fieldErrors?.weeklyGoal?.[0]} />
          </div>
        </div>
      </section>

      <FormError message={state.error} />
      <SubmitButton pendingLabel={dict.onboarding.submitPending}>
        {dict.onboarding.submitLabel}
      </SubmitButton>
    </form>
  );
}
