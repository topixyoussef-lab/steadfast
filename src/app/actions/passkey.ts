"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getDictionary } from "@/lib/i18n/server";
import {
  beginPasskeyAssertion as beginAssertion,
  mintSessionForUser as mintSession,
  verifyPasskeyAssertion as verifyAssertion,
} from "@/lib/webauthn-flow";
import { readChallenge as peekChallenge } from "@/lib/webauthn-server";
import {
  deletePasskey,
  insertPasskey,
  listPasskeys,
  relyingParty,
  saveChallenge,
  takeChallenge,
  webauthnUserHandle,
  type PasskeyRow,
} from "@/lib/webauthn-server";

function safeNext(next: string | undefined) {
  if (!next) return "/dashboard";
  if (!next.startsWith("/")) return "/dashboard";
  if (next.startsWith("//")) return "/dashboard";
  return next;
}

/**
 * Enrollment + management endpoints.
 *
 * The login-time assertion helpers live in src/lib/webauthn-flow.ts on purpose:
 * anything exported here is reachable from the browser, and these actions all
 * require an existing session (the password has already been accepted).
 */

const attestationSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    transports: z.array(z.string()).optional(),
  }),
  // Present on every browser response; the library types it as required.
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  type: z.literal("public-key"),
});

export type PasskeyState = {
  error?: string;
  notice?: string;
  passkeyRequired?: boolean;
  passkeyChallengeId?: string;
  passkeyOptions?: unknown;
  /**
   * The address has no fingerprint enrolled. The login page uses this to reveal
   * the password form, which is the one-time way to enrol the first fingerprint.
   */
  passkeyMissing?: boolean;
};

/**
 * Starts a passwordless sign-in.
 *
 * Step one of two. The challenge is bound to the resolved user id, so the second
 * step never has to trust an email coming back from the browser.
 */
export async function beginPasskeySignIn(
  _prev: PasskeyState,
  formData: FormData,
): Promise<PasskeyState> {
  const dict = await getDictionary();

  const email = z
    .string()
    .trim()
    .min(1, dict.errors.emailRequired)
    .email(dict.errors.emailInvalid)
    .safeParse(formData.get("email"));

  if (!email.success) {
    return { error: email.error.issues[0]?.message ?? dict.errors.emailInvalid };
  }

  const admin = await createServiceRoleClient();
  const { data, error } = await admin.rpc("passkey_user_id_for_email", {
    p_email: email.data,
  });
  const userId = typeof data === "string" ? data : null;

  // One message for "no such account" and "no passkey enrolled": distinguishing
  // them would turn this form into an account-enumeration oracle.
  if (error || !userId) {
    return { passkeyMissing: true, error: dict.auth.passkeyNotEnrolled };
  }

  const pending = await beginAssertion(userId);
  if (!pending) {
    return { passkeyMissing: true, error: dict.auth.passkeyNotEnrolled };
  }

  return {
    passkeyRequired: true,
    passkeyChallengeId: pending.challengeId,
    passkeyOptions: pending.options,
  };
}

/**
 * Step two: verifies the assertion and turns it into a Supabase session.
 *
 * The password is never read here. Proof of possession of the enrolled private
 * key IS the credential.
 */
export async function completePasskeySignIn(
  challengeId: string,
  assertionPayload: string,
  next?: string,
): Promise<PasskeyState> {
  const dict = await getDictionary();

  // Non-consuming read: we need the user id to bind the verification to.
  const pending = await peekChallenge(challengeId, "auth");
  if (!pending || !pending.userId) {
    return { error: dict.auth.passkeyChallengeExpired };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(assertionPayload);
  } catch {
    return { error: dict.auth.passkeyGeneric };
  }

  // takeChallenge consumes it, so a replayed assertion finds nothing left.
  const verified = await verifyAssertion(pending.userId, challengeId, payload);
  if (!verified.ok) {
    return { error: dict.auth.passkeyFailed };
  }

  const session = await mintSession(pending.userId);
  if (!session) return { error: dict.auth.passkeyGeneric };

  const supabase = await createClient();
  const { error: setError } = await supabase.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });

  if (setError) return { error: dict.errors.generic };

  revalidatePath("/", "layout");
  redirect(safeNext(next));
}

async function currentUser(): Promise<{
  id: string;
  email: string;
  displayName: string;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const email = user.email ?? `${user.id}@passkey.local`;
  const displayName =
    (user.user_metadata?.full_name as string | undefined) || email.split("@")[0];

  return { id: user.id, email, displayName };
}

/** Issues registration options for the signed-in user. */
export async function beginPasskeyEnrollment(): Promise<
  { challengeId: string; options: unknown } | { error: string }
> {
  const dict = await getDictionary();
  const account = await currentUser();
  if (!account) return { error: dict.auth.passkeyNeedsLogin };

  const [{ rpID }, { generateRegistrationOptions }] = await Promise.all([
    relyingParty(),
    import("@simplewebauthn/server"),
  ]);

  let existing: PasskeyRow[];
  try {
    existing = await listPasskeys(account.id);
  } catch {
    return { error: dict.auth.passkeyNeedsMigration };
  }

  const options = await generateRegistrationOptions({
    rpName: "Steadfast",
    rpID,
    userID: await webauthnUserHandle(account.id),
    userName: account.email,
    userDisplayName: account.displayName,
    // No attestation: platform authenticators (Windows Hello, Touch ID) give no
    // meaningful attestation and requesting it breaks enrollment outright.
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
    excludeCredentials: existing.map((row) => ({
      id: row.credential_id,
      transports: row.transports ?? undefined,
    })),
  });

  const challengeId = await saveChallenge(account.id, options.challenge, "register");
  return { challengeId, options };
}

/** Stores a verified new credential. */
export async function finishPasskeyEnrollment(
  challengeId: string,
  payload: unknown,
  label: string | null,
): Promise<{ ok: true; passkey: PasskeyRow } | { error: string }> {
  const dict = await getDictionary();
  const account = await currentUser();
  if (!account) return { error: dict.auth.passkeyNeedsLogin };

  const parsed = attestationSchema.safeParse(payload);
  if (!parsed.success) return { error: dict.errors.generic };

  const stored = await takeChallenge(challengeId, "register");
  if (!stored || stored.userId !== account.id) {
    return { error: dict.auth.passkeyChallengeExpired };
  }

  const [{ rpID, origin }, { verifyRegistrationResponse }] = await Promise.all([
    relyingParty(),
    import("@simplewebauthn/server"),
  ]);

  let registration;
  try {
    registration = await verifyRegistrationResponse({
      response: parsed.data,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    return { error: dict.auth.passkeyEnrollFailed };
  }

  if (!registration.verified || !registration.registrationInfo) {
    return { error: dict.auth.passkeyEnrollFailed };
  }

  const info = registration.registrationInfo;
  await insertPasskey({
    userId: account.id,
    credentialId: info.credential.id,
    publicKey: new Uint8Array(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    label: label?.trim() || null,
  });

  revalidatePath("/", "layout");

  const rows = await listPasskeys(account.id);
  return { ok: true, passkey: rows[0] };
}

export async function listCurrentPasskeys(): Promise<{
  passkeys: PasskeyRow[];
  error?: string;
}> {
  const account = await currentUser();
  if (!account) return { passkeys: [] };
  try {
    return { passkeys: await listPasskeys(account.id) };
  } catch {
    // Migration 0004 has not been applied yet, so the table is missing.
    const dict = await getDictionary();
    return { passkeys: [], error: dict.auth.passkeyNeedsMigration };
  }
}

export async function removePasskey(rowId: string): Promise<{ ok: boolean }> {
  const account = await currentUser();
  if (!account) return { ok: false };
  await deletePasskey(rowId, account.id);
  revalidatePath("/", "layout");
  return { ok: true };
}