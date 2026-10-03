-- ============================================================
-- 0. Extensions, schema, enums
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from anon;
grant  usage  on schema private to authenticated;

create table if not exists private.admin_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);
revoke all on private.admin_emails from anon, authenticated;
insert into private.admin_emails (email) values
  ('admin@example.com'), ('partner@example.com')
on conflict (email) do nothing;

create type public.user_role          as enum ('user', 'moderator', 'admin');
create type public.preference_type    as enum ('islamic', 'christian', 'general');
create type public.recovery_stage     as enum ('day_1_30', 'day_31_90', 'day_90_plus');
create type public.job_status         as enum ('open', 'in_progress', 'completed', 'cancelled');
-- Shape of the work, not who is offering it. Every post on Steadfast is work
-- somebody is offering, so 'offering'/'seeking' was never needed here; these
-- are the five values the posting form can actually produce.
create type public.job_type           as enum ('micro', 'gig', 'part_time', 'full_time', 'internship');
create type public.moderation_status  as enum ('allowed', 'flagged', 'blocked', 'failed');
create type public.alert_severity     as enum ('info', 'warning', 'critical');
create type public.alert_status       as enum ('open', 'acknowledged', 'resolved');

-- ============================================================
-- 1. Profiles (mirrors auth.users)
-- ============================================================
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  role              public.user_role       not null default 'user',
  email             text,
  display_name      text,
  avatar_url        text,
  preference_type   public.preference_type,
  recovery_stage    public.recovery_stage  not null default 'day_1_30',
  timezone          text        not null default 'UTC',
  day_cutoff_hour   smallint    not null default 5 check (day_cutoff_hour between 0 and 12),
  current_streak    integer     not null default 0 check (current_streak >= 0),
  highest_streak    integer     not null default 0 check (highest_streak >= 0),
  clean_since       date,
  last_active_day   date,
  onboarding_done   boolean     not null default false,
  weekly_goal       smallint    not null default 5 check (weekly_goal between 1 and 7),
  trust_score       smallint    not null default 100 check (trust_score between 0 and 100),
  suspended_until   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_streak_order check (highest_streak >= current_streak)
);

-- ============================================================
-- 2. Daily tasks
-- ============================================================
create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  preference_type   public.preference_type not null,
  category          text not null check (category in
                      ('quran', 'prayer', 'dhikr', 'scripture', 'reflection',
                       'meditation', 'reading', 'fitness', 'journaling', 'service', 'learning')),
  title             text not null check (char_length(title) between 3 and 120),
  description       text not null,
  estimated_minutes smallint not null default 10 check (estimated_minutes between 1 and 240),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create table public.task_completions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  task_id      uuid not null references public.tasks(id)     on delete cascade,
  day_key      date not null,
  completed_at timestamptz not null default now(),
  unique (user_id, task_id, day_key)
);

-- ============================================================
-- 3. Check-ins + panic / SOS
-- ============================================================
create table public.checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day_key    date not null,
  mood       smallint check (mood between 1 and 10),
  urge_level smallint check (urge_level between 0 and 10),
  note       text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, day_key)
);

create table public.panic_alerts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  day_key            date not null,
  source             text not null default 'panic_button'
                       check (source in ('panic_button', 'auto_urge', 'chat')),
  message            text check (char_length(message) <= 280),
  urge_level         smallint check (urge_level between 0 and 10),
  ai_response        text,
  ai_response_ms     integer,
  response_cache_key text,
  status             public.alert_status   not null default 'open',
  severity           public.alert_severity not null default 'critical',
  acknowledged_by    uuid references public.profiles(id) on delete set null,
  acknowledged_at    timestamptz,
  created_at         timestamptz not null default now()
);

-- ============================================================
-- 4. Community chat (moderated by Python before insert)
-- ============================================================
create table public.rooms (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  title       text not null,
  description text,
  is_private  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.chat_messages (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.rooms(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  content           text not null check (char_length(content) between 1 and 2000),
  is_flagged_by_ai  boolean not null default false,
  moderation_status public.moderation_status not null default 'allowed',
  reply_to          uuid references public.chat_messages(id) on delete set null,
  created_at        timestamptz not null default now(),
  edited_at         timestamptz,
  deleted_at        timestamptz
);

create table public.moderation_log (
  id              bigserial primary key,
  user_id         uuid references public.profiles(id)    on delete set null,
  message_id      uuid references public.chat_messages(id) on delete set null,
  room_id         uuid references public.rooms(id)         on delete set null,
  content_preview text,
  status          public.moderation_status not null,
  severity        public.alert_severity    not null default 'info',
  categories      text[] not null default '{}',
  matched_terms   text[] not null default '{}',
  latency_ms      integer,
  request_id      uuid,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- 5. Micro-jobs
-- ============================================================
create table public.job_categories (
  id         smallserial primary key,
  slug       text unique not null,
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  category_id        smallint references public.job_categories(id) on delete set null,
  job_type           public.job_type  not null,
  title              text not null check (char_length(title) between 5 and 120),
  description        text not null check (char_length(description) between 20 and 4000),
  price_minor        integer not null check (price_minor >= 0),
  currency           char(3) not null default 'USD',
  price_type         text not null default 'fixed'
                       check (price_type in ('fixed', 'hourly', 'negotiable')),
  status             public.job_status not null default 'open',
  is_ai_clean        boolean not null default false,
  estimated_hours    numeric(5,2),
  deadline_at        timestamptz,
  applications_count integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint jobs_price_present check (price_type = 'negotiable' or price_minor > 0)
);

create table public.job_applications (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs(id)    on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message    text check (char_length(message) <= 1000),
  status     text not null default 'pending'
               check (status in ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (job_id, user_id)
);

-- ============================================================
-- 6. Notifications
-- ============================================================
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null check (type in
              ('sos_response', 'job_match', 'job_application',
               'application_status', 'moderation_notice', 'streak_milestone', 'system')),
  title      text not null,
  body       text,
  link       text,
  metadata   jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 7. Indexes
-- ============================================================
create index profiles_role_idx             on public.profiles(role);
create index profiles_streak_idx           on public.profiles(current_streak desc);
create index profiles_preference_idx       on public.profiles(preference_type);
create index profiles_last_active_idx      on public.profiles(last_active_day desc);
create index tasks_pref_active_idx         on public.tasks(preference_type, is_active);
create index task_completions_user_day_idx on public.task_completions(user_id, day_key desc);
create index checkins_user_day_idx         on public.checkins(user_id, day_key desc);
create index panic_alerts_status_idx       on public.panic_alerts(status, created_at desc);
create index panic_alerts_user_idx         on public.panic_alerts(user_id, created_at desc);
create index chat_messages_room_created_idx on public.chat_messages(room_id, created_at desc);
create index chat_messages_flagged_idx     on public.chat_messages(is_flagged_by_ai)
                                           where is_flagged_by_ai;
create index moderation_log_created_idx    on public.moderation_log(created_at desc);
create index moderation_log_blocked_idx     on public.moderation_log(status, created_at desc)
                                           where status = 'blocked';
create index jobs_open_idx                 on public.jobs(status, created_at desc)
                                           where status = 'open';
create index jobs_category_type_idx        on public.jobs(category_id, job_type, status);
create index jobs_user_idx                 on public.jobs(user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc)
                                           where read_at is null;

-- ============================================================
-- 8. Helper functions
-- ============================================================
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.local_day(
  p_tz text, p_cutoff_hour smallint, p_at timestamptz default now()
) returns date
language sql stable as $$
  select (((p_at at time zone p_tz) - make_interval(hours => p_cutoff_hour))::date);
$$;

create or replace function private.is_admin(p_uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid and role in ('admin', 'moderator')
  );
$$;

create or replace function private.is_suspended(p_uid uuid default auth.uid())
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid and suspended_until is not null and suspended_until > now()
  );
$$;

create or replace function private.my_day_key()
returns date
language sql stable security definer set search_path = '' as $$
  select private.local_day(p.timezone, p.day_cutoff_hour)
  from public.profiles p where p.id = auth.uid();
$$;

create or replace function private.advance_streak(
  p_uid uuid, p_streak integer, p_stage public.recovery_stage
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_streak in (1, 3, 7, 14, 30, 60, 90, 180, 365) then
    insert into public.notifications (user_id, type, title, body, metadata)
    values (p_uid, 'streak_milestone',
            format('%s day streak', p_streak),
            'Keep going. Consistency is the whole game.',
            jsonb_build_object('streak', p_streak, 'stage', p_stage));
  end if;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, 'member'), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url',
    case when new.email in (select email from private.admin_emails)
         then 'admin'::public.user_role
         else 'user'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.get_my_profile()
returns public.profiles
language sql stable security definer set search_path = '' as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function private.handle_suspended_user()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.suspended_until is not null and new.suspended_until > now() then
    delete from public.notifications where user_id = new.id and type = 'moderation_notice';
  end if;
  return new;
end;
$$;

-- ============================================================
-- 9. Onboarding RPC
-- ============================================================
create or replace function public.complete_onboarding(
  p_preference  public.preference_type,
  p_display_name text default null,
  p_timezone     text default 'UTC',
  p_weekly_goal  smallint default 5
) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if private.is_suspended() then raise exception 'account suspended'; end if;

  update public.profiles set
    preference_type = p_preference,
    display_name    = coalesce(nullif(btrim(p_display_name), ''), display_name),
    timezone        = coalesce(nullif(btrim(p_timezone), ''), timezone),
    weekly_goal     = p_weekly_goal,
    clean_since     = current_date,
    current_streak  = greatest(current_streak, 1),
    highest_streak  = greatest(highest_streak, 1),
    last_active_day = private.local_day(timezone, day_cutoff_hour),
    onboarding_done = true
  where id = auth.uid()
  returning * into v_profile;

  return v_profile;
end;
$$;

-- ============================================================
-- 10. Daily task assignment (deterministic per user per day)
-- ============================================================
create or replace function public.get_daily_tasks(p_count smallint default 3)
returns table (
  task_id uuid, title text, description text, category text,
  estimated_minutes smallint, is_done boolean, completed_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_pref   public.preference_type;
  v_day    date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select p.preference_type,
         private.local_day(p.timezone, p.day_cutoff_hour)
    into v_pref, v_day
  from public.profiles p
  where p.id = v_uid;

  if v_pref is null then raise exception 'onboarding incomplete'; end if;

  return query
  with neutral as (
    select t.id
    from public.tasks t
    where t.preference_type = v_pref
      and t.is_active
      and t.category in ('fitness', 'journaling', 'service', 'learning')
    order by md5(t.id::text || v_uid::text || v_day::text)
    limit 1
  ), rotation as (
    select t.id
    from public.tasks t
    where t.preference_type = v_pref
      and t.is_active
      and t.id not in (select id from neutral)
    order by md5(t.id::text || v_uid::text || v_day::text)
    limit greatest(p_count - 1, 0)
  ), chosen as (
    select id from neutral
    union all
    select id from rotation
  )
  select t.id, t.title, t.description, t.category, t.estimated_minutes,
         (tc.id is not null), tc.completed_at
  from chosen c
  join public.tasks t on t.id = c.id
  left join public.task_completions tc
         on tc.task_id = t.id
        and tc.user_id = v_uid
        and tc.day_key = v_day
  order by t.category, t.title;
end;
$$;

-- ============================================================
-- 11. Streak + check-in RPC (server-authoritative)
-- ============================================================
create or replace function public.record_checkin(
  p_mood       smallint default null,
  p_urge_level smallint default null,
  p_note       text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_tz     text;
  v_cutoff smallint;
  v_day    date;
  v_last   date;
  v_cur    integer;
  v_high   integer;
  v_stage  public.recovery_stage;
  v_emit   boolean := false;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select p.timezone, p.day_cutoff_hour, p.last_active_day,
         p.current_streak, p.highest_streak
    into v_tz, v_cutoff, v_last, v_cur, v_high
  from public.profiles p
  where p.id = v_uid
  for update;

  v_day := private.local_day(v_tz, v_cutoff);

  insert into public.checkins (user_id, day_key, mood, urge_level, note)
  values (v_uid, v_day, p_mood, p_urge_level, p_note)
  on conflict (user_id, day_key) do update
    set mood       = coalesce(excluded.mood, public.checkins.mood),
        urge_level = coalesce(excluded.urge_level, public.checkins.urge_level),
        note       = coalesce(excluded.note, public.checkins.note),
        created_at = now();

  if v_last is null or v_last = v_day then
    v_cur := greatest(v_cur, 1);
  elsif v_last = v_day - 1 then
    v_cur := v_cur + 1;
    v_emit := true;
  else
    v_cur := 1;
  end if;

  v_high := greatest(v_high, v_cur);
  v_stage := case when v_cur > 90 then 'day_90_plus'::public.recovery_stage
                  when v_cur > 30 then 'day_31_90'::public.recovery_stage
                  else 'day_1_30'::public.recovery_stage end;

  update public.profiles set
    current_streak  = v_cur,
    highest_streak  = v_high,
    last_active_day = v_day,
    recovery_stage  = v_stage
  where id = v_uid;

  if v_emit then
    perform private.advance_streak(v_uid, v_cur, v_stage);
  end if;

  return jsonb_build_object(
    'day_key', v_day, 'current_streak', v_cur,
    'highest_streak', v_high, 'recovery_stage', v_stage
  );
end;
$$;

create or replace function public.complete_task(p_task_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_tz       text;
  v_cutoff   smallint;
  v_day      date;
  v_inserted boolean := false;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select p.timezone, p.day_cutoff_hour
    into v_tz, v_cutoff
  from public.profiles p
  where p.id = v_uid;

  v_day := private.local_day(v_tz, v_cutoff);

  insert into public.task_completions (user_id, task_id, day_key)
  values (v_uid, p_task_id, v_day)
  on conflict (user_id, task_id, day_key) do nothing
  returning true into v_inserted;

  if v_inserted then
    perform public.record_checkin(null, null, null);
  end if;

  return jsonb_build_object('day_key', v_day, 'newly_completed', v_inserted);
end;
$$;

-- ============================================================
-- 12. Admin: panic intake + stats
-- ============================================================
create or replace function public.log_panic(
  p_message           text default null,
  p_urge_level        smallint default null,
  p_ai_response       text default null,
  p_ai_response_ms    integer default null,
  p_response_cache_key text default null,
  p_source            text default 'panic_button'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_tz  text;
  v_cutoff smallint;
  v_day date;
  v_id  uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select p.timezone, p.day_cutoff_hour into v_tz, v_cutoff
  from public.profiles p where p.id = v_uid;

  v_day := private.local_day(v_tz, v_cutoff);

  insert into public.panic_alerts
    (user_id, day_key, source, message, urge_level,
     ai_response, ai_response_ms, response_cache_key)
  values (v_uid, v_day, p_source, p_message, p_urge_level,
          p_ai_response, p_ai_response_ms, p_response_cache_key)
  returning id into v_id;

  insert into public.notifications (user_id, type, title, body, metadata)
  values (v_uid, 'sos_response',
          'You are not alone',
          coalesce(p_ai_response,
                   'Breathe. You reached out, and that already matters.'),
          jsonb_build_object('alert_id', v_id));

  insert into public.notifications (user_id, type, title, body, metadata)
  select r.id, 'system', 'SOS alert raised',
         format('%s needs support', coalesce(p.display_name, 'A member')),
         jsonb_build_object('alert_id', v_id, 'user_id', v_uid, 'urgency', p_urge_level)
  from public.profiles r
  cross join public.profiles p
  where r.role in ('admin', 'moderator')
    and r.id <> v_uid
    and p.id = v_uid;

  return v_id;
end;
$$;

create or replace function public.get_admin_stats()
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;

  return jsonb_build_object(
    'users', jsonb_build_object(
      'total',     (select count(*) from public.profiles),
      'active_7d', (select count(*) from public.profiles
                     where last_active_day >= current_date - 7),
      'suspended', (select count(*) from public.profiles
                     where suspended_until > now())),
    'streaks', jsonb_build_object(
      'avg',        coalesce((select round(avg(current_streak)::numeric, 1)
                               from public.profiles), 0),
      'max',        coalesce((select max(highest_streak) from public.profiles), 0),
      'over_30',    (select count(*) from public.profiles where current_streak > 30),
      'at_risk_7d', (select count(*) from public.profiles
                      where last_active_day < current_date - 7
                        and created_at < now() - interval '7 days')),
    'jobs', jsonb_build_object(
      'open',    (select count(*) from public.jobs where status = 'open'),
      'total',   (select count(*) from public.jobs),
      'flagged', (select count(*) from public.jobs where not is_ai_clean)),
    'moderation', jsonb_build_object(
      'last_24h',        (select count(*) from public.moderation_log
                           where created_at > now() - interval '24 hours'),
      'blocked_24h',     (select count(*) from public.moderation_log
                           where status = 'blocked'
                             and created_at > now() - interval '24 hours'),
      'block_rate_pct',  coalesce((select round(
                             (count(*) filter (where status = 'blocked')::numeric
                              / nullif(count(*), 0)) * 100, 1)
                             from public.moderation_log
                             where created_at > now() - interval '24 hours'), 0),
      'avg_latency_ms',  coalesce((select round(avg(latency_ms))
                             from public.moderation_log
                             where created_at > now() - interval '24 hours'), 0)),
    'sos', jsonb_build_object(
      'open',     (select count(*) from public.panic_alerts where status = 'open'),
      'last_24h', (select count(*) from public.panic_alerts
                    where created_at > now() - interval '24 hours'))
  );
end;
$$;

-- ============================================================
-- 13. Triggers
-- ============================================================
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create trigger profiles_touch
  before update on public.profiles
  for each row execute function private.touch_updated_at();

create trigger jobs_touch
  before update on public.jobs
  for each row execute function private.touch_updated_at();

-- ============================================================
-- 14. Row Level Security
-- ============================================================
alter table public.profiles         enable row level security;
alter table public.tasks            enable row level security;
alter table public.task_completions enable row level security;
alter table public.checkins         enable row level security;
alter table public.panic_alerts     enable row level security;
alter table public.rooms            enable row level security;
alter table public.chat_messages    enable row level security;
alter table public.moderation_log   enable row level security;
alter table public.job_categories   enable row level security;
alter table public.jobs             enable row level security;
alter table public.job_applications enable row level security;
alter table public.notifications    enable row level security;

create policy "profiles_select_self_or_staff" on public.profiles
  for select to authenticated
  using (id = auth.uid() or private.is_admin());

create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (id = auth.uid() and not private.is_suspended())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

create policy "profiles_admin_all" on public.profiles
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "tasks_read_authenticated" on public.tasks
  for select to authenticated
  using (is_active or private.is_admin());

create policy "tasks_admin_write" on public.tasks
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "task_completions_own" on public.task_completions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "checkins_own" on public.checkins
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "panic_alerts_insert_own" on public.panic_alerts
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "panic_alerts_select_own_or_staff" on public.panic_alerts
  for select to authenticated
  using (user_id = auth.uid() or private.is_admin());

create policy "panic_alerts_staff_update" on public.panic_alerts
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "rooms_read" on public.rooms
  for select to authenticated
  using (not is_private or private.is_admin());

create policy "rooms_admin_write" on public.rooms
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- No INSERT policy on chat_messages by design: only the service_role key
-- (Next.js route handler) writes rows, and only after Python moderation.
create policy "chat_read" on public.chat_messages
  for select to authenticated
  using (
    deleted_at is null
    and exists (
      select 1 from public.rooms rm
      where rm.id = room_id and (not rm.is_private or private.is_admin())
    )
  );

create policy "chat_update_own" on public.chat_messages
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "chat_admin_delete" on public.chat_messages
  for delete to authenticated
  using (private.is_admin());

create policy "moderation_log_admin_read" on public.moderation_log
  for select to authenticated
  using (private.is_admin());

create policy "job_categories_read" on public.job_categories
  for select to anon, authenticated
  using (true);

create policy "job_categories_admin_write" on public.job_categories
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "jobs_read_open" on public.jobs
  for select to authenticated
  using (status = 'open' or user_id = auth.uid() or private.is_admin());

create policy "jobs_insert_own" on public.jobs
  for insert to authenticated
  with check (user_id = auth.uid() and not private.is_suspended());

create policy "jobs_update_own" on public.jobs
  for update to authenticated
  using (user_id = auth.uid() and not private.is_suspended())
  with check (user_id = auth.uid());

create policy "jobs_admin_all" on public.jobs
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

create policy "applications_read" on public.job_applications
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.jobs j where j.id = job_id and j.user_id = auth.uid())
    or private.is_admin()
  );

create policy "applications_insert_own" on public.job_applications
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "applications_update_own_or_owner" on public.job_applications
  for update to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.jobs j where j.id = job_id and j.user_id = auth.uid())
  );

create policy "notifications_own" on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy "notifications_update_own" on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 15. Realtime
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- ============================================================
-- 16. Seed data
-- ============================================================
insert into public.rooms (slug, title, description) values
  ('main-hall',     'Main Hall',       'General recovery chat. Moderated 24/7.'),
  ('4am-support',   '4AM Support',     'For the nights when it gets hard.'),
  ('job-board',     'Job Board',       'Share work, find work. No cold approaches.'),
  ('introductions', 'Introductions',   'New here? Introduce yourself.'),
  ('victories',     'Victories',       'Streak milestones and small wins.')
on conflict (slug) do nothing;

insert into public.job_categories (slug, name) values
  ('graphic-design', 'Graphic Design'),
  ('video-editing',  'Video Editing'),
  ('web-dev',        'Web Development'),
  ('writing',        'Writing & Translation'),
  ('data-entry',     'Data Entry'),
  ('social-media',   'Social Media'),
  ('tutoring',       'Tutoring'),
  ('other',          'Other')
on conflict (slug) do nothing;

insert into public.tasks (preference_type, category, title, description, estimated_minutes) values
  ('islamic','quran','Read one page of the Quran','Read slowly. If you cannot read Arabic, read any translation.',5),
  ('islamic','quran','Memorize one ayah','Pick an ayah you already understand. Say it until it is yours.',10),
  ('islamic','dhikr','Astaghfirullah 33 times','Say it out loud. Tape it to your desk if it helps.',3),
  ('islamic','dhikr','SubhanAllah 33 times','After each prayer, or whenever your hands are busy.',3),
  ('islamic','prayer','Pray the five daily prayers on time','Set alarms. Missed one? Pray it immediately, do not despair.',10),
  ('islamic','prayer','Pray Fajr in congregation','One prayer with other people changes the whole day.',15),
  ('islamic','reflection','Write one line of gratitude','Even "still here" counts.',2),
  ('islamic','fitness','20 push-ups or a walk','Move the body. The urge follows stillness.',20),
  ('islamic','service','Help someone expecting nothing back','Send a message, return a favour, share food.',10),
  ('islamic','learning','Learn one skill for 25 minutes','Any skill that creates something.',25),

  ('christian','scripture','Read one chapter of the Bible','Start with the Gospel of John or a Psalm.',10),
  ('christian','scripture','Memorize one verse','Pick a verse you can say from memory today.',5),
  ('christian','prayer','Morning prayer','Ten minutes of quiet before the day starts.',10),
  ('christian','prayer','Evening reflection','Where did you see grace today? Where did you fall short?',10),
  ('christian','reflection','Journal one line of hope','Write it in your own words.',2),
  ('christian','fitness','20 push-ups or a walk','Shake off the restlessness physically.',20),
  ('christian','service','One act of service','Serve someone who cannot repay you.',15),
  ('christian','learning','Study a topic or skill for 25 minutes','Pick one subject. Stay inside it.',25),

  ('general','meditation','Ten minutes of silence','No phone, no music. Sit. Count breaths when the mind wanders.',10),
  ('general','meditation','Box breathing 4-4-4-4','In for four, hold four, out for four, hold four. Ten rounds.',4),
  ('general','reading','Read twenty pages of any book','Fiction, science, history. Anything that is not a feed.',25),
  ('general','journaling','Write three lines about the urge','Name it to shrink it. Keep this one to yourself.',5),
  ('general','journaling','Write one win from today','Small counts. Write it anyway.',3),
  ('general','fitness','Workout or a thirty minute walk','Sweat is a physiological reset.',30),
  ('general','learning','Twenty-five minutes of deep work','One task, timer on, notifications off.',25),
  ('general','service','Message someone you drifted from','Connection beats isolation.',10),
  ('general','reflection','Name your three most common triggers','Write them down. Plan around them, not inside them.',10);
