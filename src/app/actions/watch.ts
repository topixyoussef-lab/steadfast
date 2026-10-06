"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/dal";

/**
 * The member arms or disarms his own protection agreement.
 *
 * Both writes go through SECURITY DEFINER functions (0011) that act as
 * `auth.uid()` — never a client-supplied parameter — so a member can only
 * touch their own consent row. There is deliberately no INSERT/UPDATE policy
 * on `monitoring_consents`; the RPC is the only door.
 */
export async function enableMonitoringWatchAction() {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("monitoring_consent_enable");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function revokeMonitoringWatchAction() {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("monitoring_consent_revoke");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}