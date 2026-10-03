"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { LOCALE_COOKIE, locales, type Locale } from "@/lib/i18n/config";

export async function setLocaleAction(next: string) {
  const target = (locales as readonly string[]).includes(next)
    ? (next as Locale)
    : null;

  const store = await cookies();

  if (target) {
    store.set(LOCALE_COOKIE, target, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  } else {
    store.delete(LOCALE_COOKIE);
  }

  // The locale changes <html lang/dir> and every server-rendered string, so the
  // whole router cache has to be rebuilt rather than just this segment.
  revalidatePath("/", "layout");
}