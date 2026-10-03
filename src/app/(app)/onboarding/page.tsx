import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getProfile } from "@/lib/dal";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { getDictionary } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const dict = await getDictionary();
  const profile = await getProfile();

  if (!profile) redirect("/login");
  if (profile.onboarding_done) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh w-full flex-col safe-t safe-b px-5 py-8 lg:px-8">
      <header className="flex flex-col gap-2 pb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dict.onboarding.pageTitle}
        </h1>
        <p className="text-base leading-relaxed text-muted">
          {dict.onboarding.pageIntro}
        </p>
      </header>

      <div className="w-full max-w-3xl rounded-2xl border bg-surface p-5 shadow-sm shadow-black/10 sm:p-8">
        <OnboardingForm />
      </div>

      <p className="mt-6 text-center text-xs text-faint">
        {dict.onboarding.changeLater}
      </p>
    </main>
  );
}
