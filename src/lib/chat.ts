/**
 * `chat_messages` columns the thread renders, shared by the room page's first
 * page and the client's re-reads: a mismatch here means the poll silently stops
 * carrying reply, edit, and flag state.
 */
export const MESSAGE_COLUMNS =
  "id, room_id, user_id, content, is_flagged_by_ai, moderation_status, reply_to, created_at, edited_at, deleted_at";
