"use client";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

export function webauthnAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

/**
 * Prompts for the fingerprint / face and returns the assertion as JSON.
 *
 * Throws a tagged error so callers can distinguish "user pressed cancel" from a
 * genuine failure; both are recoverable but deserve different messages.
 */
export async function assertPasskey(options: unknown): Promise<string> {
  const { startAuthentication } = await import("@simplewebauthn/browser");

  try {
    const response = await startAuthentication({
      optionsJSON: options as Parameters<typeof startAuthentication>[0]["optionsJSON"],
    });
    return JSON.stringify(response);
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    if (name === "NotAllowedError" || name === "AbortError") {
      throw new Error("cancelled");
    }
    throw new Error("failed");
  }
}

/** Prompts to enrol this device and returns the attestation as JSON. */
export async function registerPasskey(options: unknown): Promise<string> {
  const { startRegistration } = await import("@simplewebauthn/browser");

  try {
    const response = await startRegistration({
      optionsJSON: options as Parameters<typeof startRegistration>[0]["optionsJSON"],
    });
    return JSON.stringify(response);
  } catch (error) {
    const name = (error as { name?: string })?.name ?? "";
    if (name === "NotAllowedError" || name === "AbortError") {
      throw new Error("cancelled");
    }
    throw new Error("failed");
  }
}