import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.auth.signupTitle };
}

export default async function SignupPage({
  searchParams,
}: PageProps<"/signup">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return <AuthForm mode="signup" next={next} />;
}
