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
 */
export const ATTACHMENT_COLUMNS =
  "id, message_id, user_id, kind, mime_type, byte_size, description, duration_seconds, moderation_status, created_at";

export const MESSAGE_COLUMNS = `id, room_id, user_id, content, is_flagged_by_ai, moderation_status, reply_to, created_at, edited_at, deleted_at, attachments (${ATTACHMENT_COLUMNS})`;
