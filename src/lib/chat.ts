/**
 * `chat_messages` columns the thread renders, shared by the room page's first
 * page and the client's re-reads: a mismatch here means the poll silently stops
 * carrying reply, edit, and flag state.
 *
 * The nested `attachments(...)` is what makes a posted photo appear without a
 * second query. It has to be spelled out rather than `*`, because the RLS on
 * chat_message_attachments hides staged rows from other members and PostgREST's
 * embedded selects do not apply the parent table's policy to anything but the
 * join key -- so this list is the same one /api/media/[id] returns, minus
 * storage_path.
 *
 * Built with a template literal, not `.join()` or concatenation. The project
 * runs an untyped Supabase client, so supabase-js infers the result row from the
 * *literal* type of the select string; widen it to `string` and every caller
 * silently becomes `GenericStringError[]`, which is the same shape at runtime but
 * will not cast to ChatMessage.
 *
 * The *_BASE variants are for a database that has not taken 0009 yet. Naming a
 * column that does not exist is a PostgREST error rather than a null field, so
 * `select(MESSAGE_COLUMNS)` against an un-migrated database returns no data at
 * all and the room page calls notFound(). Leaving the new parts off renders the
 * app without media instead of not rendering at all. See src/lib/chat-schema.ts
 * for how the database is asked which shape it has.
 *
 * Because a ternary over two constants is not a literal type, callers pass it to
 * `.select()` and then cast the rows -- the shape differs by a branch the
 * compiler cannot see, so there is nothing for supabase-js to parse.
 */
export const ATTACHMENT_COLUMNS =
  "id, message_id, user_id, kind, mime_type, byte_size, description, duration_seconds, moderation_status, created_at";

export const MESSAGE_COLUMNS_BASE =
  "id, room_id, user_id, content, is_flagged_by_ai, moderation_status, reply_to, created_at, edited_at, deleted_at";

export const MESSAGE_COLUMNS = `${MESSAGE_COLUMNS_BASE}, attachments (${ATTACHMENT_COLUMNS})`;

export const ROOM_COLUMNS_BASE = "id, slug, title, description, is_private";

export const ROOM_COLUMNS = `${ROOM_COLUMNS_BASE}, chat_locked, voice_enabled, media_enabled`;
