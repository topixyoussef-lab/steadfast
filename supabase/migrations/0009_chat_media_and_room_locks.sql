-- ============================================================
-- 0009: chat media, per-room posting locks
-- ============================================================
--
-- Two features, one paste, in the order the code depends on them.
--
--  1. Room switches. `chat_locked` closes a room to posting entirely and
--     `voice_enabled` / `media_enabled` close one channel inside a room that is
--     still open. Read is never affected: `chat_read` and `rooms_read` are
--     untouched, so a locked room still renders its history to staff and to
--     whoever could already see it.
--
--  2. `chat_message_attachments`, a private-bucket media table, and the
--     `chat_messages.content` CHECK relaxed to zero characters.
--
-- The invariant this file exists to protect: **no unreviewed media ever becomes
-- addressable.** chat_messages has no client INSERT policy (0001) and its only
-- writer is /api/moderate after Python moderation. That table below follows the
-- same rule -- no INSERT policy at all -- so a browser holding the publishable
-- key cannot put a file path into the database and render it. Files land in
-- `chat-media`, a private bucket with no anon/authenticated SELECT policy
-- whatsoever, and are only reachable through /api/media/[id], which checks the
-- caller can read the parent message and then hands back a short-lived signed
-- URL. A leaked storage path is therefore not a leaked file.
--
-- A staged attachment (`message_id is null`) is visible only to its uploader.
-- Claiming happens in the same service-role transaction that writes the
-- message, and only for rows the caller owns that are still unclaimed, so an
-- attachment can never be attached to somebody else's message and can never be
-- attached twice.
--
-- Depends on 0001, 0006. Additive and idempotent.

-- ============================================================
-- 1. Room switches
-- ============================================================
-- Both default to the state the rooms are already in: open to posting, voice
-- and media on. An existing database therefore behaves identically after this
-- paste; nothing is locked until somebody locks it on purpose.

alter table public.rooms
  add column if not exists chat_locked    boolean not null default false,
  add column if not exists voice_enabled  boolean not null default true,
  add column if not exists media_enabled  boolean not null default true;

comment on column public.rooms.chat_locked is
  'Room accepts no new messages from anyone. Reading is unaffected.';
comment on column public.rooms.voice_enabled is
  'Room accepts voice notes. Has no effect once chat_locked is true.';
comment on column public.rooms.media_enabled is
  'Room accepts image and video uploads. Has no effect once chat_locked is true.';

-- ============================================================
-- 2. Attachment kind
-- ============================================================
do $$ begin
  if not exists (
    select 1 from pg_type where typname = 'attachment_kind'
  ) then
    create type public.attachment_kind as enum ('image', 'audio', 'video');
  end if;
end $$;

-- ============================================================
-- 3. Relax the content CHECK so an attachment can stand alone
-- ============================================================
-- 0001 made `content` carry the whole message, so a photo posted with no
-- caption was rejected by the database for a rule about prose. The media now
-- lives beside the text, so this keeps only the length limit.
--
-- What the database therefore does *not* enforce is "not both empty": a row with
-- no caption and no attachment is insertable here. That rule lives in
-- /api/moderate, which is chat_messages' only writer and refuses a post with
-- neither half before it reaches this table. Stating it plainly rather than
-- implying a constraint that is not there, because a future client INSERT policy
-- would be writing into a column with no floor.

do $$ declare v_conname text;
begin
  -- Drop every old content check by its real name. The generator ACLs and the
  -- migrations before 0009 have spelled this constraint at least three ways, so
  -- the name is matched by the definition, not hardcoded -- and the current
  -- one, chat_messages_content_range, is excluded so a re-run finds nothing to
  -- drop and this block is idempotent instead of tripping on itself.
  for v_conname in
    select conname
      from pg_constraint
      where conrelid = 'public.chat_messages'::regclass
        and contype = 'c'
        and conname <> 'chat_messages_content_range'
        and pg_get_constraintdef(oid) ilike '%char_length(content)%'
  loop
    execute format('alter table public.chat_messages drop constraint %I', v_conname);
  end loop;
end $$;

alter table public.chat_messages
  drop constraint if exists chat_messages_content_range;
alter table public.chat_messages
  add constraint chat_messages_content_range
  check (char_length(content) <= 2000);

-- ============================================================
-- 4. Attachments
-- ============================================================
create table if not exists public.chat_message_attachments (
  id                uuid primary key default gen_random_uuid(),
  -- Null while the file is staged, between the upload route and the message
  -- that references it. Never null once the row is visible to anybody else.
  message_id        uuid references public.chat_messages(id) on delete cascade,
  user_id           uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind              public.attachment_kind not null,
  storage_path      text not null unique,
  mime_type         text not null,
  byte_size         integer not null check (byte_size > 0),
  -- Populated by the transcription pass for audio, and by the vision pass for
  -- images. Moderators read this instead of opening the file, and it is what
  -- lands in moderation_log.content_preview.
  description       text,
  duration_seconds  numeric(6, 2) check (duration_seconds is null or duration_seconds >= 0),
  moderation_status public.moderation_status not null default 'allowed',
  created_at        timestamptz not null default now()
);

alter table public.chat_message_attachments enable row level security;

-- Read follows chat_read exactly, plus the staged case. The nested exists() is
-- itself filtered by the chat_messages policy, so this stays correct if that
-- policy changes.
drop policy if exists "attachments_read" on public.chat_message_attachments;
create policy "attachments_read" on public.chat_message_attachments
  for select to authenticated
  using (
    -- Staged: only the person who just uploaded it.
    (message_id is null and user_id = auth.uid())
    or
    exists (
      select 1
      from public.chat_messages m
      join public.rooms r on r.id = m.room_id
      where m.id = message_id
        and m.deleted_at is null
        and (not r.is_private or private.is_admin())
    )
  );

-- No INSERT, UPDATE or DELETE policy for members, on purpose. An attachment is
-- a moderation artefact, not a member-authored row: it is written only after
-- the moderation service has seen the bytes, and it is removed only by the
-- cascade from its message or by service_role. Same reasoning as chat_messages.
--
-- Consequence worth stating plainly: a member cannot edit or delete their own
-- attachment row. Deleting the message removes the attachment row; the object
-- in storage is removed by the same route that soft-deletes the message.

-- The thread needs a DELETE event to drop a rendered file, and Realtime carries
-- only the primary key under the default replica identity.
alter table public.chat_message_attachments replica identity full;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_message_attachments'
  ) then
    -- Through EXECUTE rather than as a plain statement: plpgsql only parses a
    -- known set of SQL verbs and sends the rest to the executor, which is not a
    -- contract worth depending on for a DDL command inside a DO block. This form
    -- is unambiguous on every version Supabase runs.
    execute 'alter publication supabase_realtime add table public.chat_message_attachments';
  end if;
end $$;

-- ============================================================
-- 5. Private storage bucket
-- ============================================================
-- `public` is false and stays false. There is deliberately no storage policy
-- granting anon or authenticated a SELECT: serving a file is /api/media/[id]'s
-- job, because only that route can check the parent message's read policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media', 'chat-media', false, 4194304,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg',
    'video/mp4', 'video/webm'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ============================================================
-- 6. Guard: a locked room accepts no message
-- ============================================================
-- /api/moderate already refuses to write into a locked room, and staff read
-- rather than post while a room is closed. This trigger is the backstop for the
-- day someone adds a client INSERT policy to chat_messages: it holds the line
-- from inside the database, where it cannot be forgotten by a browser that
-- decides not to call the route.
--
-- service_role passes, because that is how /api/moderate and /api/media/upload
-- write. Everything else is refused outright.

create or replace function private.guard_locked_room_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if exists (
    select 1 from public.rooms r
    where r.id = new.room_id and r.chat_locked
  ) then
    raise exception 'this room is closed to new messages'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists chat_messages_guard_locked_room on public.chat_messages;
create trigger chat_messages_guard_locked_room
  before insert on public.chat_messages
  for each row execute function private.guard_locked_room_message();

-- ============================================================
-- 6b. Guard: only an admin may move the room switches
-- ============================================================
-- The console checks `role = 'admin'` in the server action, and /admin/rooms
-- refuses the page to a moderator. Neither is enough on its own: `private.
-- is_admin()` is true for 'moderator' too, and the pre-existing
-- `rooms_admin_write` policy is FOR ALL USING (private.is_admin()). A
-- moderator holding a session token can therefore bypass the action entirely
-- and PATCH chat_locked straight through PostgREST.
--
-- Closing a room is not a moderation decision like deleting a message -- it is
-- the opposite, it is the moderator being unable to post and being unable to
-- overrule an admin -- so the check cannot live in the same role test.
--
-- A trigger rather than a new policy on purpose: policies are permissive and
-- OR together, so narrowing one would leave the wide `rooms_admin_write` in
-- front of it, and column-level GRANTs would have to be re-issued every time
-- `rooms` gains a column. Only a `before update` trigger can see the old and
-- new values and refuse the one change that matters.
--
-- The comparison is `is distinct from` so re-saving a room without touching a
-- switch is allowed for moderators, which is what they are there for.

create or replace function private.guard_room_switches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role and PostgREST's own table owner bypass this; the actions run
  -- with the admin's own session, so they are covered by the checks below.
  if auth.role() = 'service_role' then
    return new;
  end if;

  if (new.chat_locked   is distinct from old.chat_locked)
     or (new.voice_enabled  is distinct from old.voice_enabled)
     or (new.media_enabled is distinct from old.media_enabled)
  then
    if not exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    ) then
      raise exception 'only an admin can change room permissions'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists rooms_guard_switches on public.rooms;
create trigger rooms_guard_switches
  before update on public.rooms
  for each row execute function private.guard_room_switches();

-- ============================================================
-- 7. Claiming: one attachment, one message, one owner
-- ============================================================
-- The claim is an UPDATE from the service role inside /api/moderate:
--
--   update chat_message_attachments
--      set message_id = <new message>
--    where id = any(<ids the member sent>)
--      and user_id = <the member>
--      and message_id is null
--
-- and it is followed by a count check: if the number of rows updated is not the
-- number of ids sent, the message is refused. That is what stops a member from
-- attaching somebody else's staged file, or the same file twice, by sending ids
-- that were not theirs. The function therefore checks the count itself and
-- raises rather than leaving the caller to remember.
--
-- Returning the claimed rows also lets the route echo the attachments back in
-- the optimistic message, so the sender sees their own file immediately instead
-- of waiting for Realtime.

create or replace function public.claim_message_attachments(
  p_message_id uuid,
  p_attachment_ids uuid[],
  p_user_id     uuid
)
returns setof public.chat_message_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed integer;
begin
  -- coalesce matters here and nowhere else in this file. auth.role() reads a
  -- GUC that is absent on a connection with no JWT, so it can be NULL, and
  -- `null <> 'service_role'` is NULL rather than true -- an IF on that does not
  -- fire, which would turn this guard into a no-op for exactly the caller it is
  -- meant to stop. The revoke below is the real boundary; this is the second
  -- lock on the door.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_attachment_ids is null or cardinality(p_attachment_ids) = 0 then
    return;
  end if;

  update public.chat_message_attachments a
     set message_id = p_message_id
   where a.id = any(p_attachment_ids)
     and a.user_id = p_user_id
     and a.message_id is null;

  get diagnostics v_claimed = row_count;

  if v_claimed <> cardinality(p_attachment_ids) then
    raise exception 'attachment not found or already used'
      using errcode = '42501';
  end if;

  return query
    select a.* from public.chat_message_attachments a
    where a.id = any(p_attachment_ids)
      and a.message_id = p_message_id
    order by a.created_at;
end;
$$;

revoke all on function public.claim_message_attachments(uuid, uuid[], uuid) from public, anon, authenticated;

-- ============================================================
-- 8. Attachments in the admin dossier
-- ============================================================
-- get_admin_user_detail (0004, re-applied in 0006) reports a member's chat
-- history. Attachments belong in that dossier too: a moderator reviewing
-- someone needs to see what they posted, not only the caption. The inner
-- projection of chat_messages gains a nested jsonb_agg so the page reads
-- `msg.attachments` off the same rows it already renders.

create or replace function public.get_admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_auth    jsonb;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = p_user_id;

  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  -- Auth-side facts that have no column on public.profiles: sign-in recency,
  -- phone, and the signup plumbing. Email-delivery bookkeeping is always null
  -- for phone accounts, so it is not reported at all.
  --
  -- The body below is otherwise byte-identical to the 0006 version. This is a
  -- create or replace, so anything left out here is not merged with what came
  -- before, it is gone -- the reason to diff the two rather than assume.
  select jsonb_build_object(
    'last_sign_in_at',      u.last_sign_in_at,
    'phone',                u.phone,
    'created_at',           u.created_at,
    'phone_confirmed_at',   u.phone_confirmed_at,
    'provider',             u.raw_app_meta_data ->> 'provider',
    'banned_until',         u.banned_until
  )
  into v_auth
  from auth.users u
  where u.id = p_user_id;

  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'auth', coalesce(v_auth, '{}'::jsonb),
    'is_suspended', (v_profile.suspended_until is not null
                     and v_profile.suspended_until > now()),

    'stats', jsonb_build_object(
      'checkins_total',    (select count(*) from public.checkins c
                            where c.user_id = p_user_id),
      'checkins_30d',     (select count(*) from public.checkins c
                            where c.user_id = p_user_id
                              and c.day_key >= current_date - 30),
      'avg_mood',         (select round(avg(c.mood)::numeric, 1) from public.checkins c
                            where c.user_id = p_user_id and c.mood is not null),
      'avg_urge',         (select round(avg(c.urge_level)::numeric, 1) from public.checkins c
                            where c.user_id = p_user_id and c.urge_level is not null),
      'last_checkin_day', (select max(c.day_key) from public.checkins c
                            where c.user_id = p_user_id),

      'tasks_done',       (select count(*) from public.task_completions t
                            where t.user_id = p_user_id),
      'tasks_done_30d',   (select count(*) from public.task_completions t
                            where t.user_id = p_user_id
                              and t.day_key >= current_date - 30),
      'active_days',      (select count(distinct t.day_key) from public.task_completions t
                            where t.user_id = p_user_id),

      'jobs_posted',      (select count(*) from public.jobs j
                            where j.user_id = p_user_id),
      'jobs_open',        (select count(*) from public.jobs j
                            where j.user_id = p_user_id and j.status = 'open'),
      'apps_made',        (select count(*) from public.job_applications a
                            where a.user_id = p_user_id),
      'apps_received',    (select count(*) from public.job_applications a
                            join public.jobs j on j.id = a.job_id
                            where j.user_id = p_user_id),

      'messages',         (select count(*) from public.chat_messages m
                            where m.user_id = p_user_id),
      'messages_flagged', (select count(*) from public.chat_messages m
                            where m.user_id = p_user_id and m.is_flagged_by_ai),
      'messages_blocked', (select count(*) from public.chat_messages m
                            where m.user_id = p_user_id
                              and m.moderation_status = 'blocked'),
      'messages_deleted', (select count(*) from public.chat_messages m
                            where m.user_id = p_user_id and m.deleted_at is not null),
      'attachments',      (select count(*) from public.chat_message_attachments a
                            where a.user_id = p_user_id),

      'panic_total',      (select count(*) from public.panic_alerts a
                            where a.user_id = p_user_id),
      'panic_open',       (select count(*) from public.panic_alerts a
                            where a.user_id = p_user_id and a.status = 'open'),
      'panic_24h',        (select count(*) from public.panic_alerts a
                            where a.user_id = p_user_id
                              and a.created_at > now() - interval '24 hours'),

      'notifications',      (select count(*) from public.notifications n
                              where n.user_id = p_user_id),
      'notifications_unread', (select count(*) from public.notifications n
                              where n.user_id = p_user_id and n.read_at is null)
    ),

    'checkins', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.day_key desc)
      from (select c.day_key, c.mood, c.urge_level, c.note, c.created_at
            from public.checkins c
            where c.user_id = p_user_id
            order by c.day_key desc
            limit 90) c
    ), '[]'::jsonb),

    'task_completions', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.completed_at desc)
      from (select tc.day_key,
                   tc.completed_at,
                   t.title,
                   t.category,
                   t.estimated_minutes
            from public.task_completions tc
            join public.tasks t on t.id = tc.task_id
            where tc.user_id = p_user_id
            order by tc.completed_at desc
            limit 90) x
    ), '[]'::jsonb),

    'panic_alerts', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc)
      from (select a.id, a.day_key, a.source, a.message, a.urge_level,
                   a.ai_response, a.status, a.severity,
                   a.acknowledged_at, a.created_at
            from public.panic_alerts a
            where a.user_id = p_user_id
            order by a.created_at desc
            limit 50) a
    ), '[]'::jsonb),

    'chat_messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at desc)
      from (select m.id, m.room_id, r.title as room_title, r.slug as room_slug,
                   m.content, m.is_flagged_by_ai, m.moderation_status,
                   m.reply_to, m.edited_at, m.deleted_at, m.created_at,
                   coalesce((
                     select jsonb_agg(
                              jsonb_build_object(
                                'id',         a.id,
                                'kind',       a.kind,
                                'mime_type',  a.mime_type,
                                'byte_size',  a.byte_size,
                                'description',a.description,
                                'moderation_status', a.moderation_status)
                              order by a.created_at)
                     from public.chat_message_attachments a
                     where a.message_id = m.id
                   ), '[]'::jsonb) as attachments
            from public.chat_messages m
            left join public.rooms r on r.id = m.room_id
            where m.user_id = p_user_id
            order by m.created_at desc
            limit 60) m
    ), '[]'::jsonb),

    'moderation_log', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc)
      from (select l.id, l.room_id, l.content_preview, l.status, l.severity,
                   l.categories, l.matched_terms, l.latency_ms, l.created_at
            from public.moderation_log l
            where l.user_id = p_user_id
            order by l.created_at desc
            limit 40) l
    ), '[]'::jsonb),

    'jobs', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.created_at desc)
      from (select j.id, j.title, j.job_type, j.status, j.price_minor,
                   j.currency, j.price_type, j.is_ai_clean, j.applications_count,
                   j.created_at, j.deadline_at
            from public.jobs j
            where j.user_id = p_user_id
            order by j.created_at desc
            limit 50) j
    ), '[]'::jsonb),

    'job_applications', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (select a.id, a.job_id, j.title as job_title, a.status, a.message,
                   a.created_at
            from public.job_applications a
            join public.jobs j on j.id = a.job_id
            where a.user_id = p_user_id
            order by a.created_at desc
            limit 50) x
    ), '[]'::jsonb),

    'notifications', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
      from (select n.id, n.type, n.title, n.body, n.link, n.read_at, n.created_at
            from public.notifications n
            where n.user_id = p_user_id
            order by n.created_at desc
            limit 50) n
    ), '[]'::jsonb)
  );
end;
$$;

