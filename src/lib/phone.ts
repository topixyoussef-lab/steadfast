// Phone numbers are Steadfast's only user identifier. There is no email.
//
// Everything here works on E.164: a '+', a country code, and a subscriber number,
// e.g. "+201001234567". The canonical form is produced by normalizePhone() and is
// what gets stored, so "01001234567" and "+201001234567" are the same account.

export type Country = {
  /** ISO 3166-1 alpha-2. */
  iso: string;
  /** International dialling prefix without the '+', e.g. "20". */
  dial: string;
  nameEn: string;
  nameAr: string;
};

// Egypt leads the list because it is the default country in the picker, and the
// other entries are the ones an Arabic-speaking user is likely to need.
export const COUNTRIES: readonly Country[] = [
  { iso: "EG", dial: "20", nameEn: "Egypt", nameAr: "مصر" },
  { iso: "SA", dial: "966", nameEn: "Saudi Arabia", nameAr: "السعودية" },
  { iso: "AE", dial: "971", nameEn: "United Arab Emirates", nameAr: "الإمارات" },
  { iso: "KW", dial: "965", nameEn: "Kuwait", nameAr: "الكويت" },
  { iso: "QA", dial: "974", nameEn: "Qatar", nameAr: "قطر" },
  { iso: "BH", dial: "973", nameEn: "Bahrain", nameAr: "البحرين" },
  { iso: "OM", dial: "968", nameEn: "Oman", nameAr: "عُمان" },
  { iso: "JO", dial: "962", nameEn: "Jordan", nameAr: "الأردن" },
  { iso: "LB", dial: "961", nameEn: "Lebanon", nameAr: "لبنان" },
  { iso: "PS", dial: "970", nameEn: "Palestine", nameAr: "فلسطين" },
  { iso: "IQ", dial: "964", nameEn: "Iraq", nameAr: "العراق" },
  { iso: "SY", dial: "963", nameEn: "Syria", nameAr: "سوريا" },
  { iso: "YE", dial: "967", nameEn: "Yemen", nameAr: "اليمن" },
  { iso: "LY", dial: "218", nameEn: "Libya", nameAr: "ليبيا" },
  { iso: "SD", dial: "249", nameEn: "Sudan", nameAr: "السودان" },
  { iso: "DZ", dial: "213", nameEn: "Algeria", nameAr: "الجزائر" },
  { iso: "MA", dial: "212", nameEn: "Morocco", nameAr: "المغرب" },
  { iso: "TN", dial: "216", nameEn: "Tunisia", nameAr: "تونس" },
  { iso: "MR", dial: "222", nameEn: "Mauritania", nameAr: "موريتانيا" },
  { iso: "SO", dial: "252", nameEn: "Somalia", nameAr: "الصومال" },
  { iso: "DJ", dial: "253", nameEn: "Djibouti", nameAr: "جيبوتي" },
  { iso: "TR", dial: "90", nameEn: "Turkey", nameAr: "تركيا" },
  { iso: "IR", dial: "98", nameEn: "Iran", nameAr: "إيران" },
  { iso: "PK", dial: "92", nameEn: "Pakistan", nameAr: "باكستان" },
  { iso: "IN", dial: "91", nameEn: "India", nameAr: "الهند" },
  { iso: "BD", dial: "880", nameEn: "Bangladesh", nameAr: "بنغلاديش" },
  { iso: "ID", dial: "62", nameEn: "Indonesia", nameAr: "إندونيسيا" },
  { iso: "MY", dial: "60", nameEn: "Malaysia", nameAr: "ماليزيا" },
  { iso: "GB", dial: "44", nameEn: "United Kingdom", nameAr: "المملكة المتحدة" },
  { iso: "DE", dial: "49", nameEn: "Germany", nameAr: "ألمانيا" },
  { iso: "FR", dial: "33", nameEn: "France", nameAr: "فرنسا" },
  { iso: "NL", dial: "31", nameEn: "Netherlands", nameAr: "هولندا" },
  { iso: "ES", dial: "34", nameEn: "Spain", nameAr: "إسبانيا" },
  { iso: "IT", dial: "39", nameEn: "Italy", nameAr: "إيطاليا" },
  { iso: "SE", dial: "46", nameEn: "Sweden", nameAr: "السويد" },
  { iso: "US", dial: "1", nameEn: "United States", nameAr: "الولايات المتحدة" },
  { iso: "CA", dial: "1", nameEn: "Canada", nameAr: "كندا" },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

export function countryByIso(iso: string): Country {
  return COUNTRIES.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY;
}

/** Strips everything a phone keypad or a paste can add except digits and a leading +. */
function scrub(raw: string): string {
  // Arabic-Indic digits (٠١٢…) and Eastern Arabic-Indic digits (۰۱۲…) are what an
  // Arabic keyboard actually produces, so they have to be folded to ASCII.
  const toAsciiDigits = (s: string) =>
    s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
     .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

  return toAsciiDigits(raw.trim())
    .replace(/[\s()\-.]/g, "")
    .replace(/[^\d+]/g, "")
    .replace(/(?!^)\+/g, "");
}

/**
 * Canonical E.164 for a national number under a known country.
 *
 * Returns null when the result could not be a real number: an international
 * number needs 8-15 digits in total, and a national one needs the country's own
 * length to be plausible. Trunk prefixes are preserved rather than guessed at,
 * because rewriting "+20 10…" into "+2010…" correctly requires per-country
 * national-numbering knowledge that is not worth carrying here.
 */
export function normalizePhone(dial: string, national: string): string | null {
  const d = scrub(dial).replace(/\D/g, "");
  const n = scrub(national);
  if (!d || !n) return null;

  // The user typed the whole international number themselves; trust it over the
  // picker so pasting "+201001234567" while Egypt is selected still works.
  if (n.startsWith("+")) return validateE164(n);

  const body = n.replace(/^0+/, "");
  if (!body) return null;

  return validateE164(`+${d}${body}`);
}

/** Normalizes something already in international form, e.g. from a database row. */
export function normalizePhoneLoose(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = scrub(raw);
  if (!s) return null;
  if (s.startsWith("+")) return validateE164(s);
  if (s.startsWith("00")) return validateE164(`+${s.slice(2)}`);
  return validateE164(`+${s}`);
}

function validateE164(candidate: string): string | null {
  const full = candidate.replace(/^\+/, "");
  if (!/^[1-9][0-9]{6,14}$/.test(full)) return null;
  return `+${full}`;
}

/** Groups a canonical number for reading: +20 100 123 4567. */
export function formatPhone(phone: string | null | undefined): string {
  const canonical = normalizePhoneLoose(phone);
  if (!canonical) return "";

  const iso = guessCountry(canonical);
  const rest = canonical.slice(1 + iso.dial.length);
  const groups = rest.match(/.{1,3}/g) ?? [];
  // A lone trailing digit reads as a typo ("+20 120 767 901 7"); fold it into
  // the group before it so ten-digit numbers end 3-3-4, as they are dialled.
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    const merged = `${groups[groups.length - 2]}${groups[groups.length - 1]}`;
    groups.splice(groups.length - 2, 2, merged);
  }
  return `+${iso.dial} ${groups.join(" ")}`.trim();
}

/** The country whose code the number starts with. Falls back to the default. */
export function guessCountry(canonical: string): Country {
  const digits = canonical.replace(/\D/g, "");
  return (
    COUNTRIES.find((c) => digits.startsWith(c.dial) && digits.length > c.dial.length) ??
    DEFAULT_COUNTRY
  );
}

/** The national part as it should appear in the input, with the trunk zero kept. */
export function nationalPart(phone: string | null | undefined): string {
  const canonical = normalizePhoneLoose(phone);
  if (!canonical) return "";
  const iso = guessCountry(canonical);
  const rest = canonical.slice(1 + iso.dial.length);
  return iso.iso === "EG" && !rest.startsWith("0") ? `0${rest}` : rest;
}

/**
 * The synthetic auth.users.email that GoTrue insists on.
 *
 * "+201001234567" becomes "p201001234567@phone.invalid". The '+' is dropped
 * because it is not legal unquoted in an email local part, and ".invalid" is
 * reserved by RFC 2606 so the address can never be delivered anywhere.
 */
export function phoneToAuthEmail(phone: string): string {
  return `p${phone.replace(/\D/g, "")}@phone.invalid`;
}

/** Inverse of phoneToAuthEmail, for rendering an auth user that has no phone. */
export function authEmailToPhone(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = /^p([1-9][0-9]{6,14})@phone\.invalid$/.exec(email);
  return m ? `+${m[1]}` : null;
}