"use client";

import { useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";

/**
 * The permanent SOS affordance. It is a plain button on purpose: no
 * long-press, no double confirmation, no friction. If someone is fighting
 * an urge at 4am they should not have to prove they are serious.
 */
export function PanicButton({ className }: { className?: string }) {
  const { dict } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-12 items-center justify-center gap-2 rounded-2xl bg-danger text-sm font-semibold text-white shadow-sm transition",
          "hover:brightness-110 active:scale-[0.99]",
          className,
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden="true">
          <path
            d="M12 9v4m0 4h.01M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {dict.panic.ctaLabel}
      </button>

      {open && <PanicSheet onClose={() => setOpen(false)} />}
    </>
  );
}

type Support = {
  response: string;
  steps: { title: string; detail: string }[];
  grounding: string[];
  escalated: boolean;
  degraded: boolean;
};

function PanicSheet({ onClose }: { onClose: () => void }) {
  const { dict } = useI18n();
  const [urgeLevel, setUrgeLevel] = useState(7);
  const [trigger, setTrigger] = useState("");
  const [pending, setPending] = useState(false);
  const [support, setSupport] = useState<Support | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/panic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urgeLevel, trigger: trigger || null }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(
          data.error ?? dict.panic.reachFailed,
        );
        return;
      }

      setSupport({
        response: data.support.response,
        steps: data.support.steps,
        grounding: data.support.grounding,
        escalated: data.support.escalate_to_admins,
        degraded: data.degraded === true,
      });
    } catch {
      setError(dict.panic.networkFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dict.panic.dialogLabel}
      className="fixed inset-0 z-50 flex flex-col bg-canvas safe-t safe-b"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 overflow-y-auto px-5 py-6">
        <header className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">
            {support ? dict.panic.titleAlone : dict.panic.titleAsking}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-line px-3 text-sm text-muted hover:text-ink"
          >
            {dict.common.close}
          </button>
        </header>

        {support ? (
          <SupportView support={support} />
        ) : (
          <div className="flex flex-col gap-6">
            <p className="text-base leading-relaxed text-muted">{dict.panic.intro}</p>

            <div className="flex flex-col gap-3">
              <label htmlFor="urge" className="text-sm font-medium">
                {dict.panic.urgeLabel}{" "}
                <span className="text-danger">{urgeLevel}</span> {dict.panic.ofTen}
              </label>
              <input
                id="urge"
                type="range"
                min={0}
                max={10}
                value={urgeLevel}
                onChange={(e) => setUrgeLevel(Number(e.target.value))}
                className="h-3 w-full appearance-none rounded-full bg-sunken accent-danger"
              />
              <div className="flex justify-between text-[11px] text-faint">
                <span>{dict.panic.manageable}</span>
                <span>{dict.panic.overwhelmingMax}</span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="trigger" className="text-sm font-medium text-muted">
                {dict.panic.triggerLabel}{" "}
                <span className="text-faint">({dict.common.optional})</span>
              </label>
              <input
                id="trigger"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value.slice(0, 120))}
                placeholder={dict.panic.triggerPlaceholder}
                className="h-12 rounded-xl border border-line bg-surface px-4 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void send()}
              disabled={pending}
              aria-busy={pending}
              className="h-14 w-full rounded-2xl bg-danger text-base font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
            >
              {pending ? dict.panic.gettingHelp : dict.panic.cta}
            </button>

            <p className="text-center text-xs text-faint">{dict.panic.emergency}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SupportView({ support }: { support: Support }) {
  const { dict } = useI18n();
  return (
    <div className="flex flex-col gap-6">
      {support.degraded && (
        <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">{dict.panic.degraded}</p>
      )}

      <p className="text-lg leading-relaxed">{support.response}</p>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {dict.panic.doNow}
        </h3>
        <ol className="flex flex-col gap-3">
          {support.steps.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-3 rounded-2xl border bg-surface p-4"
            >
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-contrast"
              >
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">{step.title}</span>
                <span className="text-sm leading-relaxed text-muted">
                  {step.detail}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <details className="rounded-2xl border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {dict.panic.tryIfFading}
        </summary>
        <ul className="mt-3 flex flex-col gap-2">
          {support.grounding.map((item) => (
            <li key={item} className="text-sm leading-relaxed text-muted">
              {item}
            </li>
          ))}
        </ul>
      </details>

      {support.escalated && (
        <p className="text-center text-xs text-faint">{dict.panic.moderatorAlerted}</p>
      )}
    </div>
  );
}