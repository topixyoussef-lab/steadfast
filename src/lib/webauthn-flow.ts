import "server-only";

import { z } from "zod";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  findPasskey,
  listPasskeys,
  relyingParty,
  saveChallenge,
  takeChallenge,
  touchPasskey,
} from "@/lib/webauthn-server";

/**
 * Login-flow helpers.
 *
 * Deliberately NOT server actions. A "use server" export is an HTTP endpoint the
 * browser can call directly, and these would let anyone enumerate which accounts
 * have enrolled a passkey and mint challenges for arbitrary user ids. They are
 * imported only by src/app/actions/auth.ts, which reaches them after the correct
 * password has already been verified.
 */

const assertionSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().optional(),
  }),
  // Present on every browser response; the library types it as required.
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  type: z.literal("public-key"),
});

export type PendingAssertion = {
  challengeId: string;
  options: unknown;
};

/**
 * Mints a real Supabase session for a user WITHOUT their password and without
 * sending any email.
 *
 * How it works: the service role calls admin.generateLink with type=magiclink,
 * which only produces a token, then exchanges that token_hash at /auth/v1/verify
 * for a normal session pair. No mail is dispatched at any point and the token
 * never leaves the server, so this is safe to call exclusively behind a verified
 * WebAuthn assertion - which is exactly how signInWithPasskey uses it.
 *
 * Supabase has no native passkey sign-in, so this is the seam that lets a
 * biometric assertion produce a first-party session that auth.uid() and every RLS
 * policy already understand.
 */
export async function mintSessionForUser(
  userId: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const admin = await createServiceRoleClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userError || !email) return null;

  const linkRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });

  if (!linkRes.ok) return null;
  const link = (await linkRes.json()) as { hashed_token?: string };
  if (!link.hashed_token) return null;

  // The type must match the verification_type emitted by generate_link.
  const verifyRes = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token }),
  });

  if (!verifyRes.ok) return null;
  const session = (await verifyRes.json()) as {
    access_token?: string;
    refresh_token?: string;
  };

  if (!session.access_token || !session.refresh_token) return null;

  return { accessToken: session.access_token, refreshToken: session.refresh_token };
}

/**
 * Builds authentication options for a user who has already cleared the password
 * check. Returns null when the user has no passkey enrolled.
 */
export async function beginPasskeyAssertion(
  userId: string,
): Promise<PendingAssertion | null> {
  let stored: Awaited<ReturnType<typeof listPasskeys>>;
  try {
    stored = await listPasskeys(userId);
  } catch {
    // The passkey tables do not exist yet (migration 0004 not applied). Fall
    // through to a plain password sign-in rather than breaking login for
    // everyone the moment a security-hardening migration is missing.
    return null;
  }

  if (stored.length === 0) return null;

  const [{ rpID }, { generateAuthenticationOptions }] = await Promise.all([
    relyingParty(),
    import("@simplewebauthn/server"),
  ]);

  const options = await generateAuthenticationOptions({
    rpID,
    // A fingerprint means user verification, not just key presence.
    userVerification: "required",
    allowCredentials: stored.map((row) => ({
      id: row.credential_id,
      transports: row.transports ?? undefined,
    })),
  });

  const challengeId = await saveChallenge(userId, options.challenge, "auth");
  return { challengeId, options };
}

/**
 * Verifies a WebAuthn assertion against the stored credential. Succeeds only when
 * the signature, origin, RP id, challenge and owning user all line up.
 */
export async function verifyPasskeyAssertion(
  userId: string,
  challengeId: string,
  payload: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const parsed = assertionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "malformed" };

  const stored = await takeChallenge(challengeId, "auth");
  if (!stored) return { ok: false, reason: "challenge" };
  if (stored.userId !== userId) return { ok: false, reason: "user" };

  const row = await findPasskey(parsed.data.id);
  if (!row) return { ok: false, reason: "unknown" };
  if (row.user_id !== userId) return { ok: false, reason: "mismatch" };

  const [{ rpID, origin }, { verifyAuthenticationResponse }] = await Promise.all([
    relyingParty(),
    import("@simplewebauthn/server"),
  ]);

  try {
    const verification = await verifyAuthenticationResponse({
      response: parsed.data,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: row.credential_id,
        publicKey: new Uint8Array(row.public_key),
        counter: row.counter,
        transports: row.transports ?? undefined,
      },
    });

    if (!verification.verified) return { ok: false, reason: "signature" };

    await touchPasskey(row.id, verification.authenticationInfo.newCounter);
    return { ok: true };
  } catch {
    return { ok: false, reason: "signature" };
  }
}