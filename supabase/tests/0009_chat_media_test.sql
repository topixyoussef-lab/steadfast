-- Verifies 0009_chat_media_and_room_locks.sql. Apply every migration first, then
-- run this as a role that can create roles and switch to authenticated, e.g.
--   powershell -File scripts\verify-db.ps1 -Port 5433 supabase\tests\0009_chat_media_test.sql
-- Exits non zero, or raises, on the first failed assertion.
--
-- The three things this migration asserts about itself are all "something else
-- must not be able to do this", so most of the file is about proving a refusal
-- happened rather than a row appeared:
--
--   1. A staged file is invisible to everybody except the member who uploaded it,
--      and to nobody at all until it is claimed by a message.
--   2. Only the service role may claim, and a claim is all-or-nothing, so ids
--      that are not the caller's own cannot be smuggled onto a message.
--   3. Only an admin may move the three room switches -- the check that
--      rooms_admin_write alone does not provide, because private.is_admin() is
--      true for moderators too.

\set ON_ERROR_STOP on
\pset pager off

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

do $$
declare
  v_admin      uuid := '11111111-1111-1111-1111-111111111111';
  v_moderator  uuid := '22222222-2222-2222-2222-222222222222';
  v_poster     uuid := '33333333-3333-3333-3333-333333333333';
  v_bystander  uuid := '44444444-4444-4444-4444-444444444444';
  v_room       uuid;
  v_locked     uuid;
  v_msg        uuid;
  v_own_file   uuid;
  v_claimable  uuid;
  v_theirs     uuid;
  v_rows       integer;
  v_seen       integer;
  v_content    text;
begin
  ---------------------------------------------------------------- fixtures
  insert into auth.users (id, email) values
    (v_admin,     'boss@test.local'),
    (v_moderator, 'mod@test.local'),
    (v_poster,    'poster@test.local'),
    (v_bystander, 'bystander@test.local');

  update public.profiles set role = 'admin'     where id = v_admin;
  update public.profiles set role = 'moderator' where id = v_moderator;

  insert into public.rooms (slug, title) values ('general', 'General')
    returning id into v_room;
  insert into public.rooms (slug, title, chat_locked)
    values ('quiet', 'Quiet', true) returning id into v_locked;

  -- The bucket row 0009 inserts, restated here as an assertion of its own.
  perform set_config('request.jwt.claim.role', 'anon', true);

  select count(*) into v_rows from storage.buckets where id = 'chat-media';
  if v_rows <> 1 then
    raise exception 'chat-media bucket was not created';
  end if;

  select public, file_size_limit into v_rows, v_content
    from storage.buckets where id = 'chat-media';
  if v_rows <> false then
    raise exception 'chat-media bucket must be private';
  end if;
  if v_content::text <> '4194304' then
    raise exception 'chat-media size limit is wrong: %', v_content;
  end if;

  -- No role may read the objects table directly. If any did, /api/media/[id]
  -- would be a convenience rather than the only way in.
  select count(*) into v_rows
    from information_schema.role_table_grants
   where table_schema = 'storage' and table_name = 'objects'
     and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT';
  if v_rows <> 0 then
    raise exception 'storage.objects is readable by a client role';
  end if;

  ---------------------------------------------------------------- staged files
  insert into public.chat_message_attachments (user_id, kind, mime_type, byte_size, moderation_status)
    values (v_poster, 'image', 'image/png', 1024, 'allowed') returning id into v_own_file;
  insert into public.chat_message_attachments (user_id, kind, mime_type, byte_size, moderation_status)
    values (v_bystander, 'image', 'image/png', 2048, 'allowed') returning id into v_theirs;

  set local role authenticated;

  ------------------------------------------------- 1. staged is owner-only
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_bystander::text, true);

  select count(*) into v_rows from public.chat_message_attachments where id = v_own_file;
  if v_rows <> 0 then
    raise exception 'a staged file leaked to a member who does not own it';
  end if;

  select count(*) into v_rows from public.chat_message_attachments where id = v_theirs;
  if v_rows <> 1 then
    raise exception 'a member cannot read their own staged file';
  end if;

  ------------------------------------------------- 2. clients cannot claim
  begin
    perform public.claim_message_attachments(
      v_room, array[v_theirs], v_bystander
    );
    raise exception 'a client claimed an attachment: the service_role guard is not holding';
  exception when insufficient_privilege then
    null;
  end;

  set local role service_role;

  ------------------------------------------------- 3. a claim is all-or-nothing
  -- v_own_file belongs to somebody else, so claiming it together with a
  -- legitimate id must move neither row rather than half of them.
  insert into public.chat_message_attachments (user_id, kind, mime_type, byte_size, moderation_status)
    values (v_poster, 'audio', 'audio/webm', 4096, 'allowed') returning id into v_claimable;

  begin
    perform public.claim_message_attachments(
      v_room, array[v_claimable, v_own_file], v_poster
    );
    raise exception 'a claim took somebody else''s file';
  exception when insufficient_privilege then
    null;
  end;

  select count(*) into v_rows from public.chat_message_attachments
   where id in (v_claimable, v_own_file) and message_id is not null;
  if v_rows <> 0 then
    raise exception 'a refused claim still moved a row';
  end if;

  ------------------------------------------------- 4. the good claim works
  perform public.claim_message_attachments(v_room, array[v_claimable], v_poster);

  select count(*) into v_rows from public.chat_message_attachments
   where id = v_claimable and message_id = v_room;
  if v_rows <> 1 then
    raise exception 'a legitimate claim did not attach the file';
  end if;

  -- A second claim of the same id must fail, which is what stops one upload being
  -- attached to two messages.
  begin
    perform public.claim_message_attachments(v_room, array[v_claimable], v_poster);
    raise exception 'the same file was claimed twice';
  exception when insufficient_privilege then
    null;
  end;

  ---------------------------------------------------------------- message rules
  set local role service_role;

  insert into public.chat_messages (room_id, user_id, content)
    values (v_room, v_poster, '') returning id into v_msg;

  -- Both halves empty is still refused, so the relaxed CHECK did not open the
  -- door to a message with no content at all.
  begin
    insert into public.chat_messages (room_id, user_id, content) values (v_room, v_poster, '');
    raise exception 'an empty message with no attachment was accepted';
  exception when check_violation then
    null;
  end;

  -- A locked room takes no message from the service role's own client path
  -- either, because the trigger is the only thing between them and the room.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    insert into public.chat_messages (room_id, user_id, content) values (v_locked, v_poster, 'hi');
    raise exception 'a locked room accepted a message';
  exception when insufficient_privilege then
    null;
  end;

  ---------------------------------------------------------------- room switches
  set local role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- A moderator may still edit a room, just not close it.
  perform set_config('request.jwt.claim.sub', v_moderator::text, true);
  update public.rooms set title = 'General (edited)' where id = v_room;

  begin
    update public.rooms set chat_locked = true where id = v_room;
    raise exception 'a moderator closed a room through PostgREST';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.rooms set media_enabled = false where id = v_room;
    raise exception 'a moderator turned media off through PostgREST';
  exception when insufficient_privilege then
    null;
  end;

  -- Re-saving without touching a switch stays allowed, or moderators could not
  -- maintain a room at all.
  update public.rooms set description = 'still fine' where id = v_room;

  -- An admin moves all three.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  update public.rooms set chat_locked = true, voice_enabled = false, media_enabled = false
   where id = v_room;

  select chat_locked, voice_enabled, media_enabled into v_rows, v_content, v_seen
    from public.rooms where id = v_room;
  if v_rows <> true or v_content <> 'f' or v_seen <> 'f' then
    raise exception 'an admin could not move the room switches';
  end if;

  ---------------------------------------------------------------- defaults
  select voice_enabled into v_rows from public.rooms where id = v_locked;
  if v_rows <> true then
    raise exception 'voice_enabled should default to true, not %', v_rows;
  end if;

  select count(*) into v_seen
    from pg_publication_tables
   where pubname = 'supabase_realtime' and tablename = 'chat_message_attachments';
  if v_seen = 0 then
    raise exception 'chat_message_attachments is not in the realtime publication';
  end if;

  raise notice '0009 ok';
end;
$$;
