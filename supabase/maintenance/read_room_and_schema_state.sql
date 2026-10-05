-- Answers two questions in one paste, in the state the room page reads.
--
-- 1. Does 0009 exist only PARTLY? The room page asks the database whether
--    `chat_message_attachments` is there (src/lib/chat-schema.ts) and picks its
--    column list from that answer. If the attachments table arrived but
--    rooms.chat_locked did not, the probe says "ready", the select names a
--    column that is not there, PostgREST errors, and page.tsx:40 turns that error
--    into the 404. That combination is only possible if the migration ran by
--    pieces, because the real 0009 puts both in inside one transaction.
--
-- 2. How many messages does each room actually hold, and how many are still
--    visible? `deleted_at is not null` means a soft delete, so a room can carry
--    28 rows and render empty. That is not a routing problem and no deploy
--    changes it.
--
-- Read-only. Nothing here writes.

select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms'
      and column_name = 'chat_locked')                    as room_switch_columns,
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name = 'chat_message_attachments')        as attachments_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_message_attachments')
                                                          as claim_rpc,
  (select count(*) from storage.buckets where id = 'chat-media')
                                                          as chat_media_bucket;

select concat(r.slug, ' | ', r.title, ' | private=', r.is_private,
              ' | msgs=',
              (select count(*) from public.chat_messages m
                where m.room_id = r.id),
              ' | visible=',
              (select count(*) from public.chat_messages m
                where m.room_id = r.id and m.deleted_at is null)) as room
  from public.rooms r
 order by r.slug;
