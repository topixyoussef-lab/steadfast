"use client";

import { useState, useTransition } from "react";

import { completeTaskAction } from "@/app/actions/tasks";
import { useI18n } from "@/components/i18n-provider";
import { categoryLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { interpolate } from "@/lib/i18n/interpolate";
import type { DailyTask } from "@/lib/types";

export function TaskList({ initialTasks }: { initialTasks: DailyTask[] }) {
  const { dict } = useI18n();
  const [tasks, setTasks] = useState(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const doneCount = tasks.filter((t) => t.is_done).length;
  const allDone = tasks.length > 0 && doneCount === tasks.length;

  function complete(taskId: string) {
    setError(null);
    const snapshot = tasks;
    const task = tasks.find((t) => t.task_id === taskId);
    if (!task || task.is_done) return;

    // Mark it done immediately. The server also writes a check-in, so the
    // streak stays alive whether or not this feels instant.
    setTasks((prev) =>
      prev.map((t) =>
        t.task_id === taskId
          ? { ...t, is_done: true, completed_at: new Date().toISOString() }
          : t,
      ),
    );

    setPendingTaskId(taskId);
    startTransition(async () => {
      const result = await completeTaskAction({ taskId });
      setPendingTaskId(null);
      if (!result.ok) {
        setTasks(snapshot);
        setError(result.error ?? dict.errors.saveFailed);
      }
    });
  }

  if (tasks.length === 0) {
    return (
      <section className="rounded-3xl border border-dashed bg-surface p-6 text-center">
        <h2 className="text-base font-semibold">{dict.tasks.noTasksTitle}</h2>
        <p className="mt-1 text-sm text-muted">{dict.tasks.noTasksBody}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="tasks-heading">
      <header className="flex items-baseline justify-between gap-3">
        <h2 id="tasks-heading" className="text-base font-semibold">
          {dict.tasks.title}
        </h2>
        <p className="text-sm text-muted">
          {interpolate(dict.tasks.doneCount, { done: doneCount, total: tasks.length })}
        </p>
      </header>

      {allDone && (
        <p
          role="status"
          className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent"
        >
          {dict.tasks.allDone}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {tasks.map((task) => {
          const pending = pendingTaskId === task.task_id;

          return (
            <li key={task.task_id}>
              <div
                className={cn(
                  "flex items-start gap-4 rounded-2xl border bg-surface p-4 shadow-sm transition",
                  task.is_done && "border-accent/25 bg-accent-soft/30",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    task.is_done
                      ? "border-accent bg-accent text-accent-contrast"
                      : "border-line bg-sunken text-faint",
                  )}
                >
                  {task.is_done ? (
                    <svg viewBox="0 0 24 24" fill="none" className="size-4">
                      <path
                        d="M20 6 9 17l-5-5"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    categoryLabel(task.category, dict).charAt(0) || "•"
                  )}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3
                      className={cn(
                        "text-base font-medium",
                        task.is_done && "text-muted line-through",
                      )}
                    >
                      {task.title}
                    </h3>
                    <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-faint">
                      {categoryLabel(task.category, dict)}
                    </span>
                    {task.estimated_minutes > 0 && (
                      <span className="text-[11px] text-faint">
                        {interpolate(dict.tasks.minutes, { n: task.estimated_minutes })}
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-muted">
                    {task.description}
                  </p>
                </div>

                {!task.is_done && (
                  <button
                    type="button"
                    onClick={() => complete(task.task_id)}
                    disabled={pending}
                    aria-busy={pending}
                    className="h-10 shrink-0 rounded-xl border border-line px-4 text-sm font-medium text-ink transition hover:border-accent hover:text-accent disabled:opacity-60"
                  >
                    {pending ? dict.tasks.saving : dict.tasks.done}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
