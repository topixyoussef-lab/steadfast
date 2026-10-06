import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed device bind codes.
 *
 * The parent (staff) generates a code for a consented member; any companion
 * puts it in the X-Watch-Bind header and the server resolves it straight to
 * that member's user id. It is a signed capability with an expiry, not a
 * database row, so creation needs no schema and revocation still rides the
 * member's own consent check inside watch_ingest.
 */

export const BIND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createBindCode(memberId: string, secret: string, ttlMs = BIND_TTL_MS): {
  code: string;
  expiresAt: number;
} {
  const expiresAt = Date.now() + ttlMs;
  const payload = Buffer.from(JSON.stringify({ u: memberId, e: expiresAt })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return { code: `${payload}.${sig}`, expiresAt };
}

export function resolveBindCode(code: string, secret: string): string | null {
  try {
    const [payload, sig] = code.split(".");
    if (!payload || !sig) return null;

    const expected = createHmac("sha256", secret).update(payload).digest("base64url");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: unknown;
      e?: unknown;
    };
    if (typeof data.u !== "string" || typeof data.e !== "number") return null;
    if (data.e < Date.now()) return null;
    return data.u;
  } catch {
    return null;
  }
}