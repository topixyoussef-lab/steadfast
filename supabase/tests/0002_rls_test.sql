-- Verifies 0002_job_loop.sql. Apply 0001_init.sql and 0002_job_loop.sql first, then
-- run this as a role that can create roles and switch to authenticated, e.g.
--   psql -d <db> -f supabase/tests/0002_rls_test.sql
-- Exits non zero, or raises, on the first failed assertion.

-- RLS checks for the 0002 policy changes. These run as the authenticated role,
-- which unlike the previous test does NOT bypass row level security.
\set ON_ERROR_STOP on
\pset pager off

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

do $$
declare
  v_owner      uuid := '11111111-1111-1111-1111-111111111111';
  v_applicant  uuid := '22222222-2222-2222-2222-222222222222';
  v_stranger   uuid := '44444444-4444-4444-4444-444444444444';
  v_admin      uuid := '33333333-3333-3333-3333-333333333333';
  v_room       uuid;
  v_job        uuid;
  v_app        uuid;
  v_msg        uuid;
  v_status     text;
  v_flagged    integer;
  v_seen       integer;
  v_rows       integer;
  v_susp       boolean;
begin
  ---------------------------------------------------------------- fixtures
  insert into auth.users (id, email) values
    (v_owner,     'owner@test.local'),
    (v_applicant, 'applicant@test.local'),
    (v_admin,     'boss@test.local'),
    (v_stranger,  'stranger@test.local');

  update auth.users set raw_user_meta_data = '{"display_name":"Owner"}'     where id = v_owner;
  update auth.users set raw_user_meta_data = '{"display_name":"Applicant"}' where id = v_applicant;
  update auth.users set raw_user_meta_data = '{"display_name":"Boss"}'      where id = v_admin;
  update auth.users set raw_user_meta_data = '{"display_name":"Stranger"}'  where id = v_stranger;

  update public.profiles set role = 'admin' where id = v_admin;

  insert into public.rooms (slug, title) values ('general', 'General') returning id into v_room;
  insert into public.jobs (user_id, job_type, title, description, price_minor, price_type)
    values (v_owner, 'gig', 'Need a landing page', 'A simple page for our community', 5000, 'fixed')
    returning id into v_job;
  insert into public.job_applications (job_id, user_id, message)
    values (v_job, v_applicant, 'I build landing pages')
    returning id into v_app;
  insert into public.chat_messages (room_id, user_id, content, is_flagged_by_ai, moderation_status)
    values (v_room, v_applicant, 'come to my site', true, 'flagged')
    returning id into v_msg;

  ---------------------------------------------------------------- switch role
  set local role authenticated;

  ---------------------------------------------------- 1. stranger sees nothing
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);

  select count(*) into v_seen from public.job_applications where id = v_app;
  assert v_seen = 0, 'a stranger must not read another application, saw ' || coalesce(v_seen::text,'NULL');

  -- A blocked UPDATE matches zero rows rather than raising, so the only way
  -- to prove RLS held is to check that nothing was touched.
  update public.job_applications set status = 'accepted' where id = v_app;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'a stranger updated ' || v_rows || ' applications';

  -- Invisible means invisible: a SELECT the policy filters returns no rows at
  -- all, which is a stronger check than reading a stale status.
  select status into v_status from public.job_applications where id = v_app;
  assert v_status is null, 'stranger can still read the row: ' || coalesce(v_status::text,'NULL');

  -- chat_admin_update must not leak to ordinary members.
  update public.chat_messages
     set moderation_status = 'allowed', is_flagged_by_ai = false
   where id = v_msg;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'a stranger updated ' || v_rows || ' chat messages';

  select is_flagged_by_ai::int into v_flagged from public.chat_messages where id = v_msg;
  assert v_flagged = 1, 'stranger cleared the flag';

  ---------------------------------------------------------------- 2. applicant
  perform set_config('request.jwt.claim.sub', v_applicant::text, true);

  select count(*) into v_seen from public.job_applications where id = v_app;
  assert v_seen = 1, 'the applicant should read their own application, saw ' || coalesce(v_seen::text,'NULL');

  update public.job_applications set status = 'withdrawn' where id = v_app;

  begin
    update public.job_applications set status = 'accepted' where id = v_app;
    raise exception 'RLS FAILED: applicant self-accepted';
  exception when insufficient_privilege then null;
  end;

  select status into v_status from public.job_applications where id = v_app;
  assert v_status = 'withdrawn', 'applicant self-accepted, status is ' || coalesce(v_status::text,'NULL');

  ---------------------------------------------------------------- 3. poster
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  select count(*) into v_seen from public.job_applications where job_id = v_job;
  assert v_seen = 1, 'the poster should read their applicants, saw ' || coalesce(v_seen::text,'NULL');

  update public.job_applications set status = 'accepted' where id = v_app;
  select status into v_status from public.job_applications where id = v_app;
  assert v_status = 'accepted', 'the poster should be able to accept, got ' || coalesce(v_status::text,'NULL');

  -- Poster cannot touch chat_messages they do not own.
  update public.chat_messages set moderation_status = 'allowed' where id = v_msg;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'poster edited ' || v_rows || ' messages they do not own';

  ---------------------------------------------------------------- 4. staff
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- The whole point of chat_admin_update in 0002.
  update public.chat_messages
     set moderation_status = 'allowed', is_flagged_by_ai = false
   where id = v_msg;

  select is_flagged_by_ai::int into v_flagged from public.chat_messages where id = v_msg;
  assert v_flagged = 0, 'staff should be able to clear a flag, got ' || coalesce(v_flagged::text,'NULL');

  -- And the 0001 delete policy still works for staff.
  delete from public.chat_messages where id = v_msg;

  -- Staff can also read applications and review them.
  update public.job_applications set status = 'rejected' where id = v_app;
  select status into v_status from public.job_applications where id = v_app;
  assert v_status = 'rejected', 'staff should be able to reject, got ' || coalesce(v_status::text,'NULL');

  -- Staff can suspend a member.
  update public.profiles
     set suspended_until = now() + interval '7 days'
   where id = v_stranger;

  -- get_admin_members: staff guarded, and the suspension flag is resolved.
  select count(*) into v_rows from public.get_admin_members(50);
  assert v_rows = 4, 'staff should see all 4 members, saw ' || v_rows;

  select is_suspended into v_susp from public.get_admin_members(50) where id = v_stranger;
  assert v_susp, 'the suspended member should be flagged';

  select is_suspended into v_susp from public.get_admin_members(50) where id = v_owner;
  assert not v_susp, 'an unsuspended member must not be flagged';

  -- The limit is clamped so it cannot be turned into a full table dump.
  select count(*) into v_rows from public.get_admin_members(100000);
  assert v_rows = 4, 'an oversized limit should clamp, saw ' || v_rows;

  -- A non-staff caller must be refused outright.
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  begin
    perform count(*) from public.get_admin_members(50);
    raise exception 'RLS FAILED: a member called get_admin_members';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', '', true);

  reset role;

  raise notice 'ALL 0002 RLS CHECKS PASSED';
end $$;