import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Card wrapper for one block of the member dossier. */
export function Section({
  title,
  count,
  children,
  className,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4",
        className,
      )}
    >
      <h3 className="flex items-baseline gap-2 text-sm font-semibold tracking-tight">
        {title}
        {count !== undefined && (
          <span className="text-xs font-normal text-muted">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

/** Compact label/value pair. Values wrap, labels do not. */
export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 text-end text-sm">{value}</dd>
    </div>
  );
}

/** Two-column definition list that wraps the fields in a <dl>. */
export function FieldList({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col divide-y divide-line/60">{children}</dl>;
}

export function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "danger" | "warning" | "good";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-xl border p-3",
        tone === "danger" && "border-danger/40 bg-danger-soft/40",
        tone === "warning" && "border-warning/40 bg-warning/10",
        tone === "good" && "border-accent/40 bg-accent-soft",
        tone === "default" && "bg-surface",
      )}
    >
      <span className="text-[11px] leading-tight text-faint">{label}</span>
      <span
        className={cn(
          "text-lg font-semibold",
          tone === "danger" && "text-danger",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Status pill. Anything the UI does not have a tone for stays neutral. */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        tone === "neutral" && "bg-sunken text-muted",
        tone === "good" && "bg-accent-soft text-accent",
        tone === "accent" && "bg-accent text-accent-contrast",
        tone === "warning" && "bg-warning/15 text-warning",
        tone === "danger" && "bg-danger-soft text-danger",
      )}
    >
      {children}
    </span>
  );
}

/** Placeholder for a section that legitimately has no rows. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted">
      {children}
    </p>
  );
}

/** Horizontal row of stat tiles. */
export function StatGrid({
  tiles,
  columns = 4,
}: {
  tiles: Array<{ label: string; value: ReactNode; tone?: "default" | "danger" | "warning" | "good" }>;
  columns?: 3 | 4;
}) {
  return (
    <div
      className={cn(
        "grid gap-2",
        columns === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3",
      )}
    >
      {tiles.map((tile) => (
        <StatTile key={tile.label} {...tile} />
      ))}
    </div>
  );
}