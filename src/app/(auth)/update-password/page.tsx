import type { Metadata } from "next";

import { AuthForm } from "@/components/auth/auth-form";
import { getDictionary } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.auth.newPasswordTitle };
}

export default function UpdatePasswordPage() {
  return <AuthForm mode="update-password" />;
}