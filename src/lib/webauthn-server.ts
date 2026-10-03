import "server-only";

import { headers } from "next/headers";

import { createServiceRoleClient } from "@/lib/supabase/server";

export type PasskeyRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string[] | null;
  device_type: string | null;
  backed_up: boolean;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
};

/**
 * The relying-party identity for the current request.
 *
 * Derived from the request rather than NEXT_PUBLIC_SITE_URL so that preview and
 * per-branch deployments on *.vercel.app each get their own rpID. WebAuthn binds
 * a credential to the exact host, so a credential enrolled on the production
 * domain can never be replayed against a preview domain.
 */
export async function relyingParty(): Promise<{ rpID: string; origin: string }> {
  const h = await headers();
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    h.get("host") ||
    "localhost:3001";

  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return { rpID: host, origin: `${proto}://${host}` };
}

/**
 * WebAuthn requires a stable user handle. Using the uuid's raw bytes is the
 * conventional choice: it is opaque, non-guessable, and never reused because
 * auth.users rows are unique.
 */
export async function webauthnUserHandle(userId: string) {
  const { isoUint8Array } = await import("@simplewebauthn/server/helpers");
  return isoUint8Array.fromUTF8String(userId);
}

/**
 * True once migration 0004 has been applied.
 *
 * The login page uses this to decide whether to lead with the fingerprint form.
 * Until the tables exist the page keeps its previous password-first layout, so
 * shipping this feature can never make signing in harder for anyone.
 */
export async function passkeyTablesReady(): Promise<boolean> {
  try {
    const supabase = await createServiceRoleClient();
    const { error } = await supabase
      .from("webauthn_credentials")
      .select("id")
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function listPasskeys(userId: string): Promise<PasskeyRow[]> {
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from("webauthn_credentials")
    .select(
      "id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, label, created_at, last_used_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listPasskeys: ${error.message}`);
  return (data ?? []) as PasskeyRow[];
}

export async function findPasskey(
  credentialId: string,
): Promise<PasskeyRow | null> {
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from("webauthn_credentials")
    .select(
      "id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, label, created_at, last_used_at",
    )
    .eq("credential_id", credentialId)
    .maybeSingle();

  if (error) throw new Error(`findPasskey: ${error.message}`);
  return (data as PasskeyRow | null) ?? null;
}

export async function insertPasskey(input: {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
  label?: string | null;
}) {
  const supabase = await createServiceRoleClient();
  const { error } = await supabase.from("webauthn_credentials").insert({
    user_id: input.userId,
    credential_id: input.credentialId,
    public_key: input.publicKey,
    counter: input.counter,
    transports: input.transports ?? null,
    device_type: input.deviceType ?? null,
    backed_up: input.backedUp ?? false,
    label: input.label ?? null,
  });

  if (error) throw new Error(`insertPasskey: ${error.message}`);
}

export async function touchPasskey(
  rowId: string,
  counter: number,
): Promise<void> {
  const supabase = await createServiceRoleClient();
  const { error } = await supabase
    .from("webauthn_credentials")
    .update({ counter, last_used_at: new Date().toISOString() })
    .eq("id", rowId);

  if (error) throw new Error(`touchPasskey: ${error.message}`);
}

export async function deletePasskey(rowId: string, userId: string) {
  const supabase = await createServiceRoleClient();
  const { error } = await supabase
    .from("webauthn_credentials")
    .delete()
    .eq("id", rowId)
    .eq("user_id", userId);

  if (error) throw new Error(`deletePasskey: ${error.message}`);
}

/**
 * Persists a pending challenge and returns its row id. The id travels with the
 * browser so the verification step can look the challenge back up.
 */
export async function saveChallenge(
  userId: string | null,
  challenge: string,
  purpose: "auth" | "register",
): Promise<string> {
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from("webauthn_challenges")
    .insert({ user_id: userId, challenge, purpose })
    .select("id")
    .single();

  if (error) throw new Error(`saveChallenge: ${error.message}`);
  return (data as { id: string }).id;
}

/**
 * Reads a challenge WITHOUT consuming it, so a caller can look up the owning user
 * before handing the same challenge to the verifier that does consume it.
 */
export async function readChallenge(
  id: string,
  purpose: "auth" | "register",
): Promise<{ challenge: string; userId: string | null } | null> {
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from("webauthn_challenges")
    .select("challenge, user_id")
    .eq("id", id)
    .eq("purpose", purpose)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw new Error(`readChallenge: ${error.message}`);
  if (!data) return null;
  return {
    challenge: (data as { challenge: string }).challenge,
    userId: (data as { user_id: string | null }).user_id,
  };
}

/**
 * Reads and deletes a challenge in one step so it cannot be replayed. Returns
 * null when the row is gone or expired.
 */
export async function takeChallenge(
  id: string,
  purpose: "auth" | "register",
): Promise<{ challenge: string; userId: string | null } | null> {
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from("webauthn_challenges")
    .delete()
    .eq("id", id)
    .eq("purpose", purpose)
    .gt("expires_at", new Date().toISOString())
    .select("challenge, user_id")
    .maybeSingle();

  if (error) throw new Error(`takeChallenge: ${error.message}`);
  if (!data) return null;
  return {
    challenge: (data as { challenge: string }).challenge,
    userId: (data as { user_id: string | null }).user_id,
  };
}