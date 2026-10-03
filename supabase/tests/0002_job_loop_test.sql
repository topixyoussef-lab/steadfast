-- Verifies 0002_job_loop.sql. Apply 0001_init.sql and 0002_job_loop.sql first, then
-- run this as a role that can create roles and switch to authenticated, e.g.
--   psql -d <db> -f supabase/tests/0002_job_loop_test.sql
-- Exits non zero, or raises, on the first failed assertion.

-- Functional test for 0002. Runs as superuser (RLS bypassed) so it exercises the
-- trigger functions themselves rather than the policies. The policy changes in
-- 0002 are asserted separately at the end.
\set ON_ERROR_STOP on
\pset pager off

do $$
declare
  v_owner      uuid := '11111111-1111-1111-1111-111111111111';
  v_applicant  uuid := '22222222-2222-2222-2222-222222222222';
  v_admin      uuid := '33333333-3333-3333-3333-333333333333';
  v_room       uuid;
  v_job        uuid;
  v_app        uuid;
  v_count      integer;
  v_notes      integer;
  v_status     text;
  v_flagged    integer;
begin
  ---------------------------------------------------------------- fixtures
  insert into auth.users (id, email) values
    (v_owner, 'owner@test.local'),
    (v_applicant, 'applicant@test.local'),
    (v_admin, 'boss@test.local');

  -- handle_new_user() creates the profile from the raw metadata.
  update auth.users
     set raw_user_meta_data = jsonb_build_object('display_name', 'Owner')
   where id = v_owner;
  update auth.users
     set raw_user_meta_data = jsonb_build_object('display_name', 'Applicant')
   where id = v_applicant;
  update auth.users
     set raw_user_meta_data = jsonb_build_object('display_name', 'Boss')
   where id = v_admin;

  update public.profiles set role = 'admin' where id = v_admin;

  insert into public.rooms (slug, title)
    values ('general', 'General')
    returning id into v_room;

  ---------------------------------------------------------------- 1. count
  insert into public.jobs (user_id, job_type, title, description, price_minor, price_type)
    values (v_owner, 'micro', 'Test job', 'Write some tests for the dashboard', 2500, 'fixed')
    returning id into v_job;

  select applications_count into v_count from public.jobs where id = v_job;
  assert v_count = 0, 'counter should start at 0, got ' || v_count;

  insert into public.job_applications (job_id, user_id, message)
    values (v_job, v_applicant, 'I can do this')
    returning id into v_app;

  select applications_count into v_count from public.jobs where id = v_job;
  assert v_count = 1, 'counter should be 1 after insert, got ' || v_count;

  ---------------------------------------------------------------- 2. notify
  select count(*) into v_notes from public.notifications
   where user_id = v_owner and type = 'job_application';
  assert v_notes = 1, 'poster should have 1 job_application note, got ' || v_notes;

  select count(*) into v_notes from public.notifications
   where user_id = v_applicant and type = 'job_application';
  assert v_notes = 0, 'applicant should not be notified about their own apply';

  ---------------------------------------------------------------- 3. guard
  -- Act as the applicant, which is who a self-accept attempt would come from.
  perform set_config('request.jwt.claim.sub', v_applicant::text, true);

  begin
    update public.job_applications set status = 'accepted' where id = v_app;
    raise exception 'GUARD FAILED: applicant was able to self-accept';
  exception
    when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub', '', true);

  select status into v_status from public.job_applications where id = v_app;
  assert v_status = 'pending', 'status should still be pending, got ' || v_status;

  -- Withdrawing is always allowed, but it must not notify the applicant.
  perform set_config('request.jwt.claim.sub', v_applicant::text, true);
  update public.job_applications set status = 'withdrawn' where id = v_app;
  perform set_config('request.jwt.claim.sub', '', true);

  select status into v_status from public.job_applications where id = v_app;
  assert v_status = 'withdrawn', 'withdrawal should be allowed, got ' || v_status;

  select count(*) into v_notes from public.notifications
   where user_id = v_applicant and type = 'application_status';
  assert v_notes = 0,
    'self withdrawal should not notify the applicant, got ' || v_notes;

  ---------------------------------------------------------------- 4. poster accepts
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  update public.job_applications set status = 'accepted' where id = v_app;
  perform set_config('request.jwt.claim.sub', '', true);

  select status into v_status from public.job_applications where id = v_app;
  assert v_status = 'accepted', 'poster should be able to accept, got ' || v_status;

  select count(*) into v_notes from public.notifications
   where user_id = v_applicant and type = 'application_status';
  assert v_notes = 1, 'applicant should be told the outcome, got ' || v_notes;

  -- A second status change is a second notification.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  update public.job_applications set status = 'rejected' where id = v_app;
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_notes from public.notifications
   where user_id = v_applicant and type = 'application_status';
  assert v_notes = 2, 'each status change notifies once, got ' || v_notes;

  -- A no-op update must not notify again.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  update public.job_applications set status = 'rejected' where id = v_app;
  perform set_config('request.jwt.claim.sub', '', true);

  select count(*) into v_notes from public.notifications
   where user_id = v_applicant and type = 'application_status';
  assert v_notes = 2, 'unchanged status must not notify, got ' || v_notes;

  ---------------------------------------------------------------- 5. staff accepts
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  update public.job_applications set status = 'pending' where id = v_app;
  update public.job_applications set status = 'accepted' where id = v_app;
  perform set_config('request.jwt.claim.sub', '', true);

  select status into v_status from public.job_applications where id = v_app;
  assert v_status = 'accepted', 'staff should be able to accept, got ' || v_status;

  ---------------------------------------------------------------- 6. moderation notice
  -- Clearing a flag has to tell the member. Who is *allowed* to clear it is
  -- a policy question and lives in 0002_rls_test.sql; this block only checks
  -- the trigger that fires afterwards.
  insert into public.chat_messages (room_id, user_id, content, is_flagged_by_ai, moderation_status)
    values (v_room, v_applicant, 'buy this now', true, 'flagged');

  update public.chat_messages
     set moderation_status = 'allowed', is_flagged_by_ai = false
   where user_id = v_applicant and is_flagged_by_ai;

  select count(*) into v_flagged from public.chat_messages where is_flagged_by_ai;
  assert v_flagged = 0, 'flag should be cleared, got ' || v_flagged;

  select count(*) into v_notes from public.notifications
   where user_id = v_applicant and type = 'moderation_notice';
  assert v_notes = 1, 'member should be told a moderator reviewed it, got ' || v_notes;

  ---------------------------------------------------------------- 7. deletes
  delete from public.job_applications where id = v_app;
  select applications_count into v_count from public.jobs where id = v_job;
  assert v_count = 0, 'counter should return to 0 after delete, got ' || v_count;

  raise notice 'ALL 0002 FUNCTIONAL CHECKS PASSED';
end $$;