import { cookies } from "next/headers";

import {
  defaultLocale,
  dir,
  LOCALE_COOKIE,
  locales,
  type Locale,
} from "@/lib/i18n/config";
import { dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/**
 * Reads the locale from the cookie on the server.
 *
 * Every locale-dependent value (the `lang` and `dir` attributes, dictionaries,
 * number formatting) has to be resolved during the server render, otherwise the
 * browser sees English markup and then swaps to Arabic, which trips the same
 * hydration mismatch we already had to suppress on <body>.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  return isLocale(raw) ? raw : defaultLocale;
}

export async function getDictionary(): Promise<Dictionary> {
  return dictionaries[await getLocale()];
}

export async function getDirection(): Promise<"rtl" | "ltr"> {
  return dir[await getLocale()];
}