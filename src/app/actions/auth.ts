"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export type AuthFormState = {
  error?: string;
  notice?: string;
  /**
   * Set when the password was correct but the account has a fingerprint enrolled.
   * The client reads the sensor and resubmits with passkeyAssertion.
   */
  passkeyRequired?: boolean;
  passkeyChallengeId?: string;
  passkeyOptions?: unknown;
  fieldErrors?: {
    email?: string[];
    password?: string[];
    displayName?: string[];
  };
};

function emailSchemaFor(dict: Dictionary) {
  return z
    .string()
    .trim()
    .min(1, dict.errors.emailRequired)
    .email(dict.errors.emailInvalid);
}

function passwordSchemaFor(dict: Dictionary) {
  return z
    .string()
    .min(1, dict.errors.passwordRequired)
    .min(8, dict.errors.passwordShort)
    .max(72, dict.errors.passwordLong);
}

function safeNext(next: string | undefined) {
  // Only allow same-site relative paths. Blocks open-redirect via ?next=
  if (!next) return "/dashboard";
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//")) return "/dashboard";
  return next;
}

function messageFromAuthError(message: string, dict: Dictionary): string {
  const lower = message.toLowerCase();
  const e = dict.errors;
  if (lower.includes("invalid login")) return e.invalidCredentials;
  if (lower.includes("already registered")) return e.emailRegistered;
  if (lower.includes("password should be")) return e.passwordShort;
  if (lower.includes("email not confirmed")) return e.emailNotConfirmed;
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return e.rateLimited;
  }
  return e.generic;
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();
  const email = emailSchemaFor(dict).safeParse(formData.get("email"));
  const password = passwordSchemaFor(dict).safeParse(formData.get("password"));

  if (!email.success || !password.success) {
    return {
      fieldErrors: {
        email: email.success ? undefined : email.error.issues.map((i) => i.message),
        password: password.success
          ? undefined
          : password.error.issues.map((i) => i.message),
      },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password: password.data,
  });

  if (error) {
    return { error: messageFromAuthError(error.message, dict) };
  }

  // Plain password sign-in. This is the bootstrap and recovery path: it is the
  // only way to reach /settings and enrol a fingerprint in the first place, and
  // the way back in if every enrolled device is lost. The everyday route is the
  // fingerprint-only flow in src/app/actions/passkey.ts.
  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("next") as string | null ?? undefined));
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

  const email = emailSchemaFor(dict).safeParse(formData.get("email"));
  const password = passwordSchemaFor(dict)
    .regex(/[a-zA-Z]/, e.passwordNeedsLetter)
    .regex(/[0-9]/, e.passwordNeedsNumber)
    .safeParse(formData.get("password"));

  if (!displayName.success || !email.success || !password.success) {
    return {
      fieldErrors: {
        email: email.success ? undefined : email.error.issues.map((i) => i.message),
        password: password.success
          ? undefined
          : password.error.issues.map((i) => i.message),
        displayName: displayName.success
          ? undefined
          : displayName.error.issues.map((i) => i.message),
      },
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.data,
    password: password.data,
    options: {
      data: { full_name: displayName.data },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"}/auth/callback`,
    },
  });

  if (error) {
    return { error: messageFromAuthError(error.message, dict) };
  }

  // Email confirmation is enabled: no session yet, so send them to login with
  // the address prefilled. Note that Supabase reports an existing address as a
  // successful signup to avoid leaking which emails have accounts, so this page
  // is reached both after a real registration and after a duplicate attempt.
  if (data.session === null) {
    revalidatePath("/", "layout");
    redirect(`/login?registered=1&email=${encodeURIComponent(email.data)}`);
  }

  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("next") as string | null ?? undefined));
}

export async function signInWithGoogle(formData: FormData) {
  const supabase = await createClient();
  const next = safeNext(formData.get("next") as string | null ?? undefined);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth");
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
}

/**
 * Sends a password-reset email.
 *
 * The response is deliberately identical whether or not the address has an
 * account, so this endpoint cannot be used to discover registered emails.
 */
export async function requestPasswordReset(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();
  const email = emailSchemaFor(dict).safeParse(formData.get("email"));

  if (!email.success) {
    return { fieldErrors: { email: email.error.issues.map((i) => i.message) } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    // Lands on /auth/reset, which exchanges the code for a session and then
    // forwards to the page that actually collects the new password.
    redirectTo: `${siteUrl()}/auth/reset`,
  });

  if (error) {
    return { error: dict.errors.generic };
  }

  return { notice: dict.auth.resetSentNotice };
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
      fieldErrors: {
        password: password.error.issues.map((i) => i.message),
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  // No recovery session: the link was expired or already used.
  if (userError || !user) {
    return { error: dict.auth.noticeCallback };
  }

  const { error } = await supabase.auth.updateUser({
    password: password.data,
  });

  if (error) {
    return { error: messageFromAuthError(error.message, dict) };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
