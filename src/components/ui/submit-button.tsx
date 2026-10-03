"use client";

import { useFormStatus } from "react-dom";

import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";

type SubmitButtonProps = {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
};

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className,
}: SubmitButtonProps) {
  const { dict } = useI18n();
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={cn(
        "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl",
        "text-base font-semibold transition-all active:scale-[0.99]",
        "disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100",
        variant === "primary" &&
          "bg-accent text-accent-contrast hover:bg-accent-strong",
        variant === "ghost" &&
          "border border-line bg-surface text-ink hover:border-line-strong",
        variant === "danger" &&
          "bg-danger text-white hover:brightness-110",
        className,
      )}
    >
      {pending ? (
        <>
          <Spinner />
          {pendingLabel ?? dict.common.working}
        </>
      ) : (
        children
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4 animate-spin"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
