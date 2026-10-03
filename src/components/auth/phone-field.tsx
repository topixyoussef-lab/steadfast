"use client";

import { useI18n } from "@/components/i18n-provider";
import { COUNTRIES, DEFAULT_COUNTRY, nationalPart } from "@/lib/phone";

type PhoneFieldProps = {
  /** Shown as the validation error list under the input. */
  errors?: string[];
  /** A canonical number to prefill, e.g. carried over from a failed attempt. */
  defaultPhone?: string;
  required?: boolean;
};

/**
 * Phone number input with a country picker.
 *
 * The country is a hidden field and the national number is a tel input, so the
 * browser shows a numeric keypad. The join happens on the server, where a bad
 * number can be reported back as a field error instead of being silently
 * mangled here.
 */
export function PhoneField({ errors, defaultPhone, required = true }: PhoneFieldProps) {
  const { dict, locale } = useI18n();
  const t = dict.auth;
  const isArabic = locale === "ar";

  // A prefilled canonical number implies its country, so preselect that one.
  const preselected = defaultPhone
    ? (COUNTRIES.find((c) => defaultPhone.startsWith(`+${c.dial}`)) ?? DEFAULT_COUNTRY)
    : DEFAULT_COUNTRY;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{t.phoneLabel}</span>

      <div
        className="flex gap-2"
        dir="ltr"
        style={{ direction: "ltr", textAlign: "left" }}
      >
        <div className="relative shrink-0">
          <label className="sr-only" htmlFor="country">
            {t.countryLabel}
          </label>
          <select
            id="country"
            name="country"
            defaultValue={preselected.iso}
            aria-label={t.countryLabel}
            className="h-11 appearance-none rounded-2xl border border-line bg-surface px-3 pe-8 text-sm font-medium text-ink focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>
                {`+${c.dial} ${isArabic ? c.nameAr : c.nameEn}`}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-faint"
          >
            ▼
          </span>
        </div>

        <input
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          name="phone"
          placeholder={t.phonePlaceholder}
          defaultValue={defaultPhone ? nationalPart(defaultPhone) : undefined}
          required={required}
          maxLength={15}
          aria-invalid={errors?.length ? true : undefined}
          className="h-11 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </div>

      {/* The chosen country is posted as ISO and re-expanded server-side, so the
          value that gets validated and stored is always full E.164. */}
      {errors?.length ? (
        <ul className="flex flex-col gap-1 text-sm text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}