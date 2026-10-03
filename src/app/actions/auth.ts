"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDictionary } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { countryByIso, normalizePhone, phoneToAuthEmail } from "@/lib/phone";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export type AuthFormState = {
  error?: string;
  notice?: string;
  fieldErrors?: {
    phone?: string[];
    password?: string[];
    displayName?: string[];
  };
};

function passwordSchemaFor(dict: Dictionary) {
  return z
    .string()
    .min(1, dict.errors.passwordRequired)
    .min(8, dict.errors.passwordShort)
    .max(72, dict.errors.passwordLong);
}

/**
 * Reads the phone from the form. The UI posts the picked country as an ISO code
 * and the national number separately, so the two are joined here rather than in
 * the client, where a bad join could not be reported back per-field.
 */
function phoneFromForm(
  formData: FormData,
  dict: Dictionary,
): { phone: string } | { error: string; fieldErrors: { phone: string[] } } {
  const country = countryByIso(String(formData.get("country") ?? ""));
  const national = normalizePhone(country.dial, String(formData.get("phone") ?? ""));

  if (!national) {
    return {
      error: dict.errors.phoneInvalid,
      fieldErrors: { phone: [dict.errors.phoneInvalid] },
    };
  }

  return { phone: national };
}

function safeNext(next: string | undefined) {
  // Only allow same-site relative paths. Blocks open-redirect via ?next=
  if (!next) return "/dashboard";
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//")) return "/dashboard";
  return next;
}

function nextTarget(formData: FormData) {
  return safeNext((formData.get("next") as string | null) ?? undefined);
}

function messageFromAuthError(message: string, dict: Dictionary): string {
  const lower = message.toLowerCase();
  const e = dict.errors;
  if (lower.includes("invalid login")) return e.invalidCredentials;
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return e.phoneRegistered;
  }
  if (lower.includes("phone") && lower.includes("registered")) return e.phoneRegistered;
  if (lower.includes("password should be")) return e.passwordShort;
  if (lower.includes("rate limit") || lower.includes("too many")) return e.rateLimited;
  return e.generic;
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();

  const phone = phoneFromForm(formData, dict);
  if ("error" in phone) return { error: phone.error, fieldErrors: phone.fieldErrors };

  const password = passwordSchemaFor(dict).safeParse(formData.get("password"));
  if (!password.success) {
    return {
      fieldErrors: { password: password.error.issues.map((i) => i.message) },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    // The account is keyed on the synthetic address derived from the phone
    // number; the number itself lives in auth.users.phone and public.profiles.
    email: phoneToAuthEmail(phone.phone),
    password: password.data,
  });

  if (error) {
    return { error: messageFromAuthError(error.message, dict) };
  }

  // Plain password sign-in is the bootstrap and recovery path: it is the only
  // way to reach /settings and enrol a first fingerprint, and the way back in
  // when every enrolled device is lost. Day-to-day sign-in is the fingerprint
  // flow in src/app/actions/passkey.ts.
  revalidatePath("/", "layout");
  redirect(nextTarget(formData));
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();
  const e = dict.errors;

  const displayName = z
    .string()
    .trim()
    .min(2, e.displayNameShort)
    .max(60, e.displayNameShort)
    .safeParse(formData.get("displayName") ?? "");

  const phone = phoneFromForm(formData, dict);
  const password = passwordSchemaFor(dict)
    .regex(/[a-zA-Z]/, e.passwordNeedsLetter)
    .regex(/[0-9]/, e.passwordNeedsNumber)
    .safeParse(formData.get("password"));

  if (!displayName.success || "error" in phone || !password.success) {
    return {
      fieldErrors: {
        phone: "error" in phone ? phone.fieldErrors.phone : undefined,
        password: password.success ? undefined : password.error.issues.map((i) => i.message),
        displayName: displayName.success
          ? undefined
          : displayName.error.issues.map((i) => i.message),
      },
      ...("error" in phone ? { error: phone.error } : {}),
    };
  }

  // Created through the service role rather than auth.signUp. Signup cannot
  // require an email confirmation, because there is no inbox to receive it: the
  // address is synthetic, so the confirmation link would be unreachable and
  // registration would dead-end. Confirming at creation time is what makes a
  // phone-only account possible at all.
  const admin = await createServiceRoleClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email: phoneToAuthEmail(phone.phone),
    phone: phone.phone,
    password: password.data,
    email_confirm: true,
    user_metadata: { full_name: displayName.data },
  });

  if (createError) {
    return { error: messageFromAuthError(createError.message, dict) };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: phoneToAuthEmail(phone.phone),
    password: password.data,
  });

  if (signInError) {
    return { error: messageFromAuthError(signInError.message, dict) };
  }

  revalidatePath("/", "layout");
  redirect(nextTarget(formData));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function updatePassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();
  const password = passwordSchemaFor(dict)
    .regex(/[a-zA-Z]/, dict.errors.passwordNeedsLetter)
    .regex(/[0-9]/, dict.errors.passwordNeedsNumber)
    .safeParse(formData.get("password"));

  if (!password.success) {
    return {
      fieldErrors: { password: password.error.issues.map((i) => i.message) },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: dict.errors.generic };
  }

  const { error } = await supabase.auth.updateUser({ password: password.data });

  if (error) {
    return { error: messageFromAuthError(error.message, dict) };
  }

  revalidatePath("/", "layout");
  redirect("/settings");
}

/**
 * Staff password reset.
 *
 * There is no self-service recovery: the account has no email, so there is no
 * inbox to send a reset link to and no SMS provider configured. Losing the
 * fingerprint and the password means an admin sets a new password here.
 */
export async function adminResetPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();

  const userId = z
    .string()
    .uuid(dict.errors.generic)
    .safeParse(formData.get("userId"));
  const password = passwordSchemaFor(dict)
    .regex(/[a-zA-Z]/, dict.errors.passwordNeedsLetter)
    .regex(/[0-9]/, dict.errors.passwordNeedsNumber)
    .safeParse(formData.get("password"));

  if (!userId.success || !password.success) {
    return { error: dict.errors.generic };
  }

  const admin = await createServiceRoleClient();

  // Authorize before mutating anything. get_admin_members raises 'forbidden'
  // unless private.is_admin() is true, so a clean call is the authorization.
  // It also picks up the trigger in 0003 that keys roles on the phone allowlist.
  const { error: authzError } = await admin.rpc("get_admin_members", { p_limit: 1 });

  if (authzError) {
    return { error: dict.errors.generic };
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(userId.data, {
    password: password.data,
  });

  if (updateError) {
    return { error: messageFromAuthError(updateError.message, dict) };
  }

  // A new password invalidates nothing else, but the member may be mid-session
  // with the old one; the admin UI says so rather than forcing it silently.
  revalidatePath("/", "layout");
  return { notice: dict.admin.user.passwordReset };
}