import { Suspense } from "react";

export default function DashboardLoading() {
  return (
    <main
      className="flex w-full flex-col gap-6 px-5 py-8 safe-t safe-b lg:px-8"
      aria-busy="true"
    >
      <div className="flex flex-col gap-2">
        <div className="h-7 w-52 animate-pulse rounded-lg bg-sunken" />
        <div className="h-4 w-72 animate-pulse rounded-lg bg-sunken" />
      </div>

      <Suspense fallback={null}>
        <div className="grid w-full gap-6 xl:grid-cols-2">
          <div className="flex flex-col gap-6">
            <div className="h-64 animate-pulse rounded-3xl border bg-surface" />
            <div className="flex flex-col gap-3">
              <div className="h-5 w-32 animate-pulse rounded-lg bg-sunken" />
              <div className="h-24 animate-pulse rounded-2xl border bg-surface" />
              <div className="h-24 animate-pulse rounded-2xl border bg-surface" />
              <div className="h-24 animate-pulse rounded-2xl border bg-surface" />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="h-32 animate-pulse rounded-3xl border bg-surface" />
            <div className="h-72 animate-pulse rounded-3xl border bg-surface" />
          </div>
        </div>
      </Suspense>
    </main>
  );
}