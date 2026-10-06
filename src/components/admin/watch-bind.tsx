"use client";

import { useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";

/**
 * Issues a one-time device bind for a consented member. The code is a signed
 * capability (lib/watch-bind): it dies after 7 days and stops the moment the
 * member switches protection off, so the parent never needs the member's
 * passwords to put monitoring on a browser.
 */
export function WatchBind({ memberId, memberName }: { memberId: string; memberName: string }) {
  const { dict } = useI18n();
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "ready"; code: string; expiresAt: number } | { kind: "error" }
  >({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function create() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/watch/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { code?: string; expiresAt?: number }
        | null;
      if (!res.ok || !data?.code) {
        setState({ kind: "error" });
        return;
      }
      setState({ kind: "ready", code: data.code, expiresAt: data.expiresAt ?? Date.now() });
    } catch {
      setState({ kind: "error" });
    }
  }

  async function copy() {
    if (state.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable; the code box stays selectable */
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={create}
        disabled={state.kind === "loading"}
        className={cn(
          "rounded-xl border border-line bg-sunken px-3 py-2 text-xs font-medium text-ink transition",
          "hover:border-accent/50 disabled:opacity-50",
        )}
      >
        {state.kind === "loading" ? dict.common.working : dict.admin.watchBindButton}
      </button>

      {state.kind === "error" && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {dict.admin.watchBindError}
        </p>
      )}

      {state.kind === "ready" && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-xl bg-sunken px-3 py-2 text-xs text-accent" dir="ltr">
              {state.code}
            </code>
            <button
              type="button"
              onClick={copy}
              className={cn(
                "shrink-0 rounded-xl border border-line bg-sunken px-3 py-2 text-xs font-medium text-ink transition",
                copied && "border-accent/50 text-accent",
              )}
            >
              {copied ? dict.admin.watchBindCopied : dict.admin.watchBindCopy}
            </button>
          </div>
          <p className="text-xs text-faint">
            {interpolate(dict.admin.watchBindExpires, {
              date: new Date(state.expiresAt).toLocaleDateString(),
            })}{" "}
            · {interpolate(dict.admin.watchBindFor, { name: memberName })}
          </p>
          <p className="text-xs text-faint">{dict.admin.watchBindHowTo}</p>
        </div>
      )}
    </div>
  );
}