export const locales = ["ar", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "ar";

export const LOCALE_COOKIE = "steadfast_locale";

export const htmlLang: Record<Locale, string> = {
  ar: "ar",
  en: "en",
};

export const dir: Record<Locale, "rtl" | "ltr"> = {
  ar: "rtl",
  en: "ltr",
};

export const localeLabel: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
};

/** BCP-47 tag used for Intl formatting of dates, numbers and plurals. */
export const intlLocale: Record<Locale, string> = {
  ar: "ar-EG",
  en: "en-GB",
};