import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * PostgREST's codes for "I asked for something that is not in the schema":
 * undefined_table, undefined_column, insufficient_privilege (the role has no
 * grant on a table that exists but postdates the role's setup) and PGRST205,
 * which is what a table missing from the schema cache usually comes back as.
 *
 * Anything else is a real failure and is deliberately not folded into "not ready",
 * so a flaky connection cannot quietly turn every room's composer off.
 */
const NOT_READY_CODES = new Set(["42P01", "42703", "42501", "PGRST205"]);

/**
 * Whether 0009 has been applied to this database.
 *
 * The media tables and the room switches ship together, so one cheap probe of the
 * attachment table answers for both: if the table is missing then neither the
 * switches nor the attachment columns are there.
 *
 * This exists for the window between deploying code and running its migration.
 * It is not a substitute for applying 0009 -- until that happens members see a
 * room with the photo and voice buttons hidden. The probe is per request and
 * costs one query, so the moment the migration lands the next render picks it up
 * with no restart and no reload.
 *
 * Asking for one column with LIMIT 1 cannot return rows to a member who is not in
 * the room: RLS filters them out and an empty result is still a success, which is
 * why "no error" is the right signal rather than "some rows came back".
 */
export async function chatMediaReady(): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_message_attachments")
    .select("id")
    .limit(1);

  if (!error) return true;
  return NOT_READY_CODES.has(error.code ?? "");
}
