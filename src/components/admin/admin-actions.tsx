"use client";

import { useState, useTransition } from "react";

import {
  acknowledgeAlertAction,
  clearMessageAction,
  deleteMessageAction,
  liftSuspensionAction,
  resolveAlertAction,
  suspendUserAction,
} from "@/app/actions/admin";
import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";

function Row({
  label,
  onClick,
  variant = "ghost",
  disabled,
}: {
  label: string;
  onClick: () => void;
  variant?: "ghost" | "danger" | "accent";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-9 rounded-xl px-3 text-xs font-medium transition disabled:opacity-50",
        variant === "ghost" &&
          "border border-line text-muted hover:border-line-strong hover:text-ink",
        variant === "accent" && "bg-accent text-accent-contrast hover:bg-accent-strong",
        variant === "danger" &&
          "border border-danger/40 text-danger hover:bg-danger-soft",
      )}
    >
      {label}
    </button>
  );
}

export function AlertActions({ alertId }: { alertId: string }) {
  const { dict } = useI18n();
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (kind: "acknowledge" | "resolve") =>
    startTransition(async () => {
      const result =
        kind === "acknowledge"
          ? await acknowledgeAlertAction({ alertId })
          : await resolveAlertAction({ alertId });
      if (result.ok) setDone(kind === "acknowledge" ? "acknowledged" : "resolved");
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {done === "resolved" ? (
        <span className="text-[11px] text-accent">{dict.admin.alertClosed}</span>
      ) : (
        <>
          {done !== "acknowledged" && (
            <Row
              label={dict.admin.iHaveThis}
              variant="accent"
              disabled={pending}
              onClick={() => run("acknowledge")}
            />
          )}
          <Row
            label={done === "acknowledged" ? dict.admin.resolveAlert : dict.admin.skipForNow}
            variant={done === "acknowledged" ? "accent" : "ghost"}
            disabled={pending}
            onClick={() => run("resolve")}
          />
        </>
      )}
    </div>
  );
}

export function MessageActions({ messageId }: { messageId: string }) {
  const { dict } = useI18n();
  const [removed, setRemoved] = useState(false);
  const [pending, startTransition] = useTransition();

  if (removed) {
    return <span className="text-[11px] text-faint">{dict.admin.removed}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Row
        label={dict.admin.looksFine}
        variant="accent"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await clearMessageAction({ messageId });
            if (result.ok) setRemoved(true);
          })
        }
      />
      <Row
        label={dict.admin.remove}
        variant="danger"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteMessageAction({ messageId });
            if (result.ok) setRemoved(true);
          })
        }
      />
    </div>
  );
}

export function SuspensionActions({
  userId,
  suspended,
}: {
  userId: string;
  suspended: boolean;
}) {
  const { dict } = useI18n();
  const [isSuspended, setSuspended] = useState(suspended);
  const [pending, startTransition] = useTransition();

  if (isSuspended) {
    return (
      <Row
        label={dict.admin.reinstateMember}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await liftSuspensionAction({ userId });
            if (result.ok) setSuspended(false);
          })
        }
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {[7, 30].map((days) => (
        <Row
          key={days}
          label={interpolate(dict.admin.suspendForDays, { n: days })}
          variant="danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await suspendUserAction({ userId, days });
              if (result.ok) setSuspended(true);
            })
          }
        />
      ))}
    </div>
  );
}