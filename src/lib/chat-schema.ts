import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Whether 0009 has been applied to this database.
 *
 * The media tables and the room switches ship together, so one cheap probe of the
 * attachment table answers for both: if the table is missing then neither the
 * switches nor the attachment columns are there.
 *
 * This exists for the window between deploying code and running its migration. It
 * is not a substitute for applying 0009 -- until that happens members see a room
 * with the photo and voice buttons hidden. The probe is per request and costs one
 * query, so the moment the migration lands the next render picks it up with no
 * restart and no reload.
 *
 * Asking for one column with LIMIT 1 cannot return rows to a member who is not in
 * the room: RLS filters them out and an empty result is still a success, which is
 * why "no error" is the right signal rather than "some rows came back".
 *
 * Only a clean success counts. A missing table comes back as PostgREST 42P01,
 * a missing column as 42703, an ungranted role as 42501, and a table absent from
 * the schema cache as PGRST205 -- but this deliberately does not branch on which
 * one it was, because the question being asked is "can I safely name the new
 * columns" and the answer to anything other than a plain success is no. A
 * connection blip degrades a room to the old column list, which still renders;
 * the other choice turns a blip into a 404.
 *
 * Getting this backwards is not subtle. This once returned
 * `NOT_READY_CODES.has(error.code)`, which answered "ready" precisely when the
 * migration was absent: every probe hit 42P01, every page asked PostgREST for
 * chat_locked, got 42703, got null for the room, and called notFound() -- so every
 * room on the platform, on the web and in the Android app, was a 404.
 */
export async function chatMediaReady(): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_message_attachments")
    .select("id")
    .limit(1);

  return !error;
}
