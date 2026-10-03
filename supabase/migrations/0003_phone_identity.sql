-- Phone-number identity.
--
-- Steadfast has no email. The user's identity is their phone number in E.164
-- form (+201001234567). Supabase's GoTrue still requires a non-null email to
-- create a user, so each account gets a synthetic internal address that no human
-- ever sees and that is never mailed:
--
--     +201001234567  ->  p201001234567@phone.invalid
--
-- `.invalid` is reserved by RFC 2606, so the address can never resolve and can
-- never be delivered to. private.is_admin() reads roles off public.profiles and
-- never touches auth.users.email, so the synthetic address is invisible to the
-- authorization model.

create or replace function private.normalize_phone(p_phone text)
returns text
language sql immutable as $$
  select case
    when p_phone is null then null
    when p_phone ~ '^\+[1-9][0-9]{6,14}$' then p_phone
    when p_phone ~ '^00[1-9][0-9]{6,14}$' then '+' || substr(p_phone, 3)
    when p_phone ~ '^[1-9][0-9]{6,14}$'   then '+' || p_phone
    else null
  end
$$;

-- The allowlist that decides who becomes an admin on signup. Keyed on phone.
create table if not exists private.admin_phones (
  phone      text primary key
              check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  created_at timestamptz not null default now()
);
revoke all on private.admin_phones from anon, authenticated;

alter table public.profiles add column if not exists phone text;

create unique index if not exists profiles_phone_key
  on public.profiles (phone)
  where phone is not null;

-- Backfill profiles created before this migration from their synthetic address.
update public.profiles p
set phone = '+' || substr(p.email, 2, position('@' in p.email) - 2)
where p.phone is null and p.email like '%@phone.invalid';

-- The email allowlist is now vestigial: roles come from private.admin_phones.
drop table if exists private.admin_emails;

-- Rewritten for phone identity. Role derivation reads auth.users.phone, and the
-- display_name fallback is the phone number rather than a split on '@'.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
declare
  v_phone text := private.normalize_phone(new.phone);
  v_email text := case
    when v_phone is null then null
    else 'p' || substr(v_phone, 2) || '@phone.invalid'
  end;
begin
  insert into public.profiles (id, email, phone, display_name, avatar_url, role)
  values (
    new.id,
    v_email,
    v_phone,
    coalesce(
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      v_phone,
      'Member'
    ),
    new.raw_user_meta_data->>'avatar_url',
    case when v_phone in (select phone from private.admin_phones)
         then 'admin'::public.user_role
         else 'user'::public.user_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Admin member directory: phone instead of email. Dropped and recreated because
-- CREATE OR REPLACE cannot change a function's OUT parameters.
drop function if exists public.get_admin_members(integer);

create or replace function public.get_admin_members(p_limit integer default 50)
  returns table (
    id              uuid,
    display_name    text,
    phone           text,
    role            public.user_role,
    current_streak  integer,
    last_active_day date,
    suspended_until timestamptz,
    is_suspended    boolean
  )
  language plpgsql stable security definer set search_path = ''
  as $$
  begin
    if not private.is_admin() then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    return query
    select p.id,
           p.display_name,
           p.phone,
           p.role,
           p.current_streak,
           p.last_active_day,
           p.suspended_until,
           (p.suspended_until is not null and p.suspended_until > now())
      from public.profiles p
     order by p.current_streak desc, p.created_at asc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
  end;
$$;

revoke all on function public.get_admin_members(integer) from public, anon, authenticated;
grant execute on function public.get_admin_members(integer) to authenticated;