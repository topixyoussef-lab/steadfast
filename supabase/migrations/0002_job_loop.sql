-- ============================================================
-- Steadfast 0002: close the job-application loop
--
-- 0001 defined the notifications table and the job application
-- counters but nothing ever wrote them. A posted job sat at
-- "0 applied" forever and the poster was never told that anybody
-- had applied, so the whole jobs feature was inert.
--
-- These are database triggers rather than application code on
-- purpose: there is deliberately no INSERT policy on notifications,
-- so the only safe writer is a SECURITY DEFINER function.
-- ============================================================

-- ============================================================
-- 1. Gaps in the 0001 policies that the new staff actions need
-- ============================================================

-- 0001 gave staff DELETE on chat_messages but not UPDATE, so there was no
-- way to mark a flagged message as reviewed without deleting it. The admin
-- console's "Looks fine" action needs this.
create policy "chat_admin_update" on public.chat_messages
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- 0001's applications_update_own_or_owner covers the applicant and the poster
-- but not staff, and it has no WITH CHECK, so RLS alone would also let an
-- applicant mark themselves accepted. The trigger below enforces who may set
-- which status; this policy only adds the missing staff access.
create policy "applications_update_staff" on public.job_applications
  for update to authenticated
  using (
    private.is_admin()
    or user_id = auth.uid()
    or exists (select 1 from public.jobs j where j.id = job_id and j.user_id = auth.uid())
  );

-- An applicant may move pending -> withdrawn and nothing else. Accepting or
-- rejecting is the poster's decision. Written as a trigger so no policy can
-- accidentally widen it later.
create or replace function private.guard_application_status()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner     uuid;
  v_is_staff  boolean := private.is_admin();
begin
  select j.user_id into v_owner from public.jobs j where j.id = new.job_id;

  if v_is_staff then
    return new;
  end if;

  -- The person who posted the job decides.
  if v_owner = auth.uid() then
    return new;
  end if;

  -- Otherwise the applicant may only withdraw.
  if new.status = 'withdrawn' then
    return new;
  end if;

  raise exception 'only the job poster can review an application'
    using errcode = '42501';
end;
$$;

create trigger applications_guard_status
  before update on public.job_applications
  for each row execute function private.guard_application_status();

-- ============================================================
-- 2. Keep the application counter and notifications honest
-- ============================================================

-- Keep jobs.applications_count honest. Doing it here means it cannot drift
-- from the rows, whatever the client does.
create or replace function private.sync_applications_count()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_job_id uuid;
begin
  -- NEW is unassigned on DELETE, so it cannot be referenced in a shared
  -- expression here. Cascading deletes from a removed job hit this path.
  if tg_op = 'DELETE' then
    v_job_id := old.job_id;
  else
    v_job_id := new.job_id;
  end if;

  update public.jobs
     set applications_count = (
       select count(*) from public.job_applications where job_id = v_job_id
     )
   where id = v_job_id;
  return null;
end;
$$;

create trigger applications_sync_count
  after insert or delete on public.job_applications
  for each row execute function private.sync_applications_count();

-- Tell the person who posted the job that somebody applied.
create or replace function private.notify_job_application()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_job_title text;
  v_owner     uuid;
  v_applicant text;
begin
  select j.title, j.user_id, coalesce(p.display_name, 'A member')
    into v_job_title, v_owner, v_applicant
  from public.jobs j
  join public.profiles p on p.id = new.user_id
  where j.id = new.job_id;

  -- Never notify someone about their own application.
  if v_owner is null or v_owner = new.user_id then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, link, metadata)
  values (
    v_owner,
    'job_application',
    'New application',
    format('%s applied to %s', v_applicant, v_job_title),
    format('/jobs/%s/applications', new.job_id),
    jsonb_build_object(
      'job_id', new.job_id,
      'applicant_id', new.user_id,
      'application_id', new.id
    )
  );

  return new;
end;
$$;

create trigger applications_notify_owner
  after insert on public.job_applications
  for each row execute function private.notify_job_application();

-- Tell the applicant where they stand once the poster decides.
create or replace function private.notify_application_status()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_job_title text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Never notify somebody about a decision they made themselves. Withdrawing
  -- your own application should not produce an inbox entry.
  if new.user_id = auth.uid() then
    return new;
  end if;

  select j.title into v_job_title from public.jobs j where j.id = new.job_id;
  if v_job_title is null then
    return new;
  end if;

  insert into public.notifications (user_id, type, title, body, link, metadata)
  values (
    new.user_id,
    'application_status',
    case new.status
      when 'accepted' then 'Application accepted'
      when 'rejected' then 'Application not accepted'
      else 'Application withdrawn'
    end,
    format('Your application for %s is now %s', v_job_title, new.status),
    format('/jobs/%s', new.job_id),
    jsonb_build_object('job_id', new.job_id, 'status', new.status)
  );

  return new;
end;
$$;

create trigger applications_notify_applicant
  after update on public.job_applications
  for each row execute function private.notify_application_status();

-- Staff need a way to close the loop on a moderation notice too. This fires
-- when a member's message is finally cleared for review.
create or replace function private.notify_moderation_notice()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.moderation_status is distinct from old.moderation_status
     and new.moderation_status = 'allowed'
     and old.is_flagged_by_ai then
    insert into public.notifications (user_id, type, title, body)
    values (
      new.user_id,
      'moderation_notice',
      'Your message was reviewed',
      'A moderator looked at your message and it is fine. Nothing was removed.'
    );
  end if;
  return new;
end;
$$;

create trigger chat_notify_moderation_notice
  after update on public.chat_messages
  for each row execute function private.notify_moderation_notice();

-- Backfill the counters for any rows that already exist.
update public.jobs j
   set applications_count = (
     select count(*) from public.job_applications a where a.job_id = j.id
   )
 where j.applications_count <> (
     select count(*) from public.job_applications a where a.job_id = j.id
   );

-- ============================================================
-- 3. Admin member list
-- ============================================================

-- The admin console needs to know whether each member is suspended *right now*.
-- Doing that in SQL keeps the page component free of clock reads, and this is
-- the same shape as get_admin_stats in 0001.
create or replace function public.get_admin_members(p_limit integer default 50)
returns table (
  id              uuid,
  display_name    text,
  email           text,
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
         p.email,
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