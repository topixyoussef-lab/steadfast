-- ============================================================
-- 0006: chat upgrades — reactions, edits, deletes, staff room
-- ============================================================
--
-- One additive, idempotent paste that gives the chat its WhatsApp-shaped
-- parts, and re-applies the fixed admin dossier on the way through.
--
-- Four things happen here:
--
--  1. A staff-only room row. `rooms.is_private` and the gate in RoomPage
--     already make a room staff-only; the only thing missing was the row.
--  2. `chat_message_reactions`, own-rows write policies, and the emoji CHECK
--     that keeps the one unmoderated write path in this schema safe.
--  3. A guard trigger on `chat_messages` UPDATEs. Without it, `chat_update_own`
--     lets a member rewrite their own message text straight from the browser
--     with the publishable key, past Python moderation. The trigger narrows a
--     member's own update to exactly one change: a one-way soft delete.
--  4. `replica identity full` on both tables, so Realtime DELETE events carry
--     enough of the old row for a client to act on.
--
-- It also carries the current `get_admin_user_detail` (created in 0004) as
-- create-or-replace, so a database holding a stale copy is fixed by the same
-- paste.
--
-- Depends on 0001 only. 0003 is not required and must not be assumed.

-- ============================================================
-- 1. Staff-only room
-- ============================================================
insert into public.rooms (slug, title, description, is_private)
values (
  'staff-room',
  'غرفة الفريق',
  'غرفة خاصة بالمشرفين فقط.',
  true
)
on conflict (slug) do nothing;

-- ============================================================
-- 2. Message reactions
-- ============================================================
-- The emoji CHECK is not decoration. Reactions are written straight from the
-- browser with the publishable key (row level security only proves the row is
-- yours), so the column is locked to a fixed set. A closed vocabulary of six
-- emoji cannot carry a slur, which is why this table needs no moderation
-- pass: there is nothing expressive it can store.

create table if not exists public.chat_message_reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji      text not null check (emoji in ('👍','❤️','😂','😮','😢','🙏')),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

alter table public.chat_message_reactions enable row level security;

-- Read: anyone who can read the message may see its reactions. The nested
-- exists() is itself filtered by the chat_messages and rooms policies, so this
-- stays correct if those change; the explicit conditions only make it legible.
drop policy if exists "reactions_read" on public.chat_message_reactions;
create policy "reactions_read" on public.chat_message_reactions
  for select to authenticated
  using (
    exists (
      select 1
      from public.chat_messages m
      join public.rooms r on r.id = m.room_id
      where m.id = message_id
        and m.deleted_at is null
        and (not r.is_private or private.is_admin())
    )
  );

drop policy if exists "reactions_insert_own" on public.chat_message_reactions;
create policy "reactions_insert_own" on public.chat_message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.chat_messages m
      join public.rooms r on r.id = m.room_id
      where m.id = message_id
        and m.deleted_at is null
        and (not r.is_private or private.is_admin())
    )
  );

drop policy if exists "reactions_delete_own" on public.chat_message_reactions;
create policy "reactions_delete_own" on public.chat_message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- DELETE events must carry message_id, not just the primary key, or a
-- subscribing client cannot tell which bubble lost a reaction.
alter table public.chat_message_reactions replica identity full;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_message_reactions'
  ) then
    alter publication supabase_realtime add table public.chat_message_reactions;
  end if;
end $$;

-- ============================================================
-- 3. Guard: members may only soft-delete their own messages
-- ============================================================
-- `chat_update_own` (0001) is `user_id = auth.uid()` and nothing more, so a
-- member could rewrite their own message text directly with the publishable
-- key, bypassing the moderated edit route. This trigger narrows what a
-- non-staff member may change to exactly one thing: deleted_at, null ->
-- non-null, and nothing else. Content changes only arrive through the service
-- role (which the edit route uses after Python moderation); staff keep the
-- existing admin paths. The one-way rule also blocks restoring content that
-- was deliberately hidden.

create or replace function private.guard_chat_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role' or private.is_admin() then
    return new;
  end if;

  if (new.id, new.room_id, new.user_id, new.content, new.reply_to,
      new.is_flagged_by_ai, new.moderation_status, new.created_at,
      new.edited_at)
     is distinct from
     (old.id, old.room_id, old.user_id, old.content, old.reply_to,
      old.is_flagged_by_ai, old.moderation_status, old.created_at,
      old.edited_at)
  then
    raise exception 'chat messages can only be edited through the moderated route'
      using errcode = '42501';
  end if;

  if old.deleted_at is distinct from new.deleted_at
     and not (old.deleted_at is null and new.deleted_at is not null)
  then
    raise exception 'a deleted message cannot be restored'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists chat_messages_guard_update on public.chat_messages;
create trigger chat_messages_guard_update
  before update on public.chat_messages
  for each row execute function private.guard_chat_message_update();

-- ============================================================
-- 4. DELETE payloads for chat_messages
-- ============================================================
-- Realtime evaluates the subscription filter (room_id=eq.<uuid>) against the
-- old row for DELETE events. With the default replica identity that row is
-- only the primary key, so a hard delete (chat_admin_delete) would never
-- reach a subscribed member.
alter table public.chat_messages replica identity full;

-- ============================================================
-- 5. Admin dossier (0004, re-applied)
-- ============================================================
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
                   m.reply_to, m.edited_at, m.deleted_at, m.created_at
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
