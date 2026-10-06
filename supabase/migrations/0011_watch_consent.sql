-- ============================================================
-- 0011: agreed watch (consent + browsing events)
-- ============================================================
-- The only monitoring this app does is the kind the member switched on
-- himself. Three ideas sit behind every object here:
--
--   1. Consent is a row in `monitoring_consents`, and ingestion refuses to run
--      for a user without an ACTIVE consent row. A member revokes consent and
--      the pipeline dries up instantly, server-side, not by the app's word.
--      Domain-level browsing data (domains + timestamps only) is collected
--      nowhere until that row exists.
--
--   2. Nothing here is covert. The member reads his own rows, he sees who can
--      see the report (the staff console, nothing else), and he can turn it
--      off at any time. There is deliberately no insert/update/delete policy
--      for members: enable/revoke goes through SECURITY DEFINER functions that
--      act as auth.uid() only, and ingestion through one that checks BOTH that
--      the caller is the member (or service_role) AND that consent is live.
--
--   3. It is a per-member opt-in, not a staff tool to browse at leisure. Even
--      the admin-side report function returns nothing for a member with no
--      active consent, so an uninformed glance cannot leak a silent record.

create table if not exists public.monitoring_consents (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  consented_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  status        text not null default 'active'
                check (status in ('active', 'revoked')),
  updated_at    timestamptz not null default now()
);

comment on table public.monitoring_consents is
  'Opt-in record of who agreed to device protection. status = revoked stops ingestion entirely.';

create table if not exists public.browsing_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  domain      text not null,
  action      text not null check (action in ('blocked', 'allowed')),
  occurred_at timestamptz not null default now()
);

create index if not exists browsing_events_user_day_idx
  on public.browsing_events (user_id, occurred_at desc);

comment on table public.browsing_events is
  'Domain visits only: no URLs, no page text, no screenshots. Written only for members with an active consent, by watch_ingest.';

alter table public.monitoring_consents enable row level security;
alter table public.browsing_events enable row level security;

-- Own row or staff. Members see their own consent; staff see the list they
-- report from. No INSERT/UPDATE/DELETE policies on purpose, same reasoning as
-- notifications and chat_messages: the SECURITY DEFINER functions are the door.
drop policy if exists "monitoring_consents_read" on public.monitoring_consents;
create policy "monitoring_consents_read" on public.monitoring_consents
  for select to authenticated
  using (user_id = auth.uid() or private.is_admin());

drop policy if exists "browsing_events_read_own_or_staff" on public.browsing_events;
create policy "browsing_events_read_own_or_staff" on public.browsing_events
  for select to authenticated
  using (user_id = auth.uid() or private.is_admin());

revoke all on table public.monitoring_consents from public, anon;
grant select on table public.monitoring_consents to authenticated;

revoke all on table public.browsing_events from public, anon;
grant select on table public.browsing_events to authenticated;

-- ============================================================
-- Enable / revoke
-- ============================================================
-- Security definer so the row can be written without a member INSERT policy;
-- always auth.uid(), never a parameter, so only the member themselves can
-- arm or disarm their own consent.

create or replace function public.monitoring_consent_enable()
returns public.monitoring_consents
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.monitoring_consents;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.monitoring_consents (user_id, consented_at, status)
  values (auth.uid(), now(), 'active')
  on conflict (user_id) do update
    set consented_at = now(),
        revoked_at   = null,
        status       = 'active',
        updated_at   = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.monitoring_consent_revoke()
returns public.monitoring_consents
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.monitoring_consents;
begin
  if auth.uid() is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.monitoring_consents
     set status     = 'revoked',
         revoked_at = now(),
         updated_at = now()
   where user_id = auth.uid()
  returning * into v_row;

  if v_row is null then
    raise exception 'no consent to revoke' using errcode = '22000';
  end if;

  return v_row;
end;
$$;

-- ============================================================
-- Ingestion
-- ============================================================
-- The only writer. p_user_id is trusted (the route pins it to the session it
-- verified) but the function still insists the caller is that member (or
-- service_role) AND that consent is live, so a stale companion that kept a
-- token after revocation floods into nothing.

create or replace function public.watch_ingest(p_events jsonb, p_user_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := coalesce(p_user_id, auth.uid());
  v_item  record;
  v_domain text;
  v_blocked boolean;
  v_at      timestamptz;
  v_n       integer := 0;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if auth.role() <> 'service_role' and v_uid <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.monitoring_consents c
     where c.user_id = v_uid and c.status = 'active'
  ) then
    raise exception 'monitoring not enabled by consent' using errcode = '42501';
  end if;

  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    return 0;
  end if;

  for v_item in select * from jsonb_array_elements(p_events)
  loop
    v_domain := lower(v_item.value ->> 'domain');
    if v_domain is null or v_domain = '' or position(' ' in v_domain) > 0 then
      continue;
    end if;
    v_blocked := coalesce((v_item.value ->> 'blocked') = 'true', false);
    v_at := coalesce((v_item.value ->> 'at')::timestamptz, now());

    insert into public.browsing_events (user_id, domain, action, occurred_at)
    values (v_uid, v_domain, case when v_blocked then 'blocked' else 'allowed' end, v_at);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- ============================================================
-- Report
-- ============================================================
-- Staff-only, and only for a member whose consent is currently active. A staff
-- user who queries a non-consenting member gets zero rows, not a leak.

create or replace function public.admin_watch_report(p_user_id uuid, p_days integer default 14)
returns table (day date, blocked bigint, allowed bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.monitoring_consents c
     where c.user_id = p_user_id and c.status = 'active'
  ) then
    return;
  end if;

  return query
    select e.occurred_at::date as day,
           count(*) filter (where e.action = 'blocked') as blocked,
           count(*) filter (where e.action = 'allowed') as allowed
      from public.browsing_events e
     where e.user_id = p_user_id
       and e.occurred_at >= now() - (greatest(1, least(coalesce(p_days, 14), 90))) * interval '1 day'
     group by e.occurred_at::date
     order by day desc;
end;
$$;

revoke all on function public.monitoring_consent_enable() from public, anon, authenticated;
revoke all on function public.monitoring_consent_revoke() from public, anon, authenticated;
revoke all on function public.watch_ingest(jsonb, uuid) from public, anon;
revoke all on function public.admin_watch_report(uuid, integer) from public, anon, authenticated;

grant execute on function public.monitoring_consent_enable() to authenticated;
grant execute on function public.monitoring_consent_revoke() to authenticated;
grant execute on function public.watch_ingest(jsonb, uuid) to authenticated;
grant execute on function public.admin_watch_report(uuid, integer) to authenticated;