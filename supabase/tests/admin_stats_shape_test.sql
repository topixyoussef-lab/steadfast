-- Verifies 0002_job_loop.sql. Apply 0001_init.sql and 0002_job_loop.sql first, then
-- run this as a role that can create roles and switch to authenticated, e.g.
--   psql -d <db> -f supabase/tests/admin_stats_shape_test.sql
-- Exits non zero, or raises, on the first failed assertion.

\pset pager off
-- Compares the real shape of get_admin_stats against what the admin page
-- reads. Any missing key would render as "undefined" in the UI.
do $$
declare
  v_owner uuid := '11111111-1111-1111-1111-111111111111';
  v_admin uuid := '33333333-3333-3333-3333-333333333333';
  v_room  uuid;
  v_json  jsonb;
  v_leaves text[];
  v_expected text[] := array[
    'users.total','users.active_7d','users.suspended',
    'streaks.avg','streaks.max','streaks.over_30','streaks.at_risk_7d',
    'jobs.open','jobs.total','jobs.flagged',
    'moderation.last_24h','moderation.blocked_24h',
    'moderation.block_rate_pct','moderation.avg_latency_ms',
    'sos.open','sos.last_24h'
  ];
  v_mismatch text := '';
  v          text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_owner, 'o@t.local', '{"display_name":"O"}'),
           (v_admin, 'a@t.local', '{"display_name":"A"}');
  update public.profiles set role = 'admin' where id = v_admin;
  update public.profiles set current_streak = 9, highest_streak = 9 where id = v_owner;
  update public.profiles set last_active_day = current_date where id = v_owner;

  insert into public.rooms (slug, title) values ('general','General') returning id into v_room;
  insert into public.jobs (user_id, job_type, title, description, price_minor, price_type)
    values (v_owner, 'micro', 'A tidy little job', 'Something worth doing here', 1000, 'fixed');
  insert into public.jobs (user_id, job_type, title, description, price_minor, price_type, is_ai_clean)
    values (v_owner, 'gig', 'An unmoderated job', 'Something posted without a check', 2000, 'fixed', false);
  insert into public.chat_messages (room_id, user_id, content) values (v_room, v_owner, 'hi');
  insert into public.panic_alerts (user_id, day_key) values (v_owner, current_date);

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select * into v_json from public.get_admin_stats();
  perform set_config('request.jwt.claim.sub', '', true);

  -- Flatten to dotted leaf paths.
  with recursive leaves as (
    select key as path, value
      from jsonb_each(v_json)
    union all
    select l.path || '.' || e.key, e.value
      from leaves l
      cross join lateral jsonb_each(l.value) as e(key, value)
    where jsonb_typeof(l.value) = 'object'
  )
  select array_agg(path) into v_leaves
    from leaves
   where jsonb_typeof(value) <> 'object';

  foreach v in array v_expected loop
    if not (v = any(v_leaves)) then
      v_mismatch := v_mismatch || v || ' ';
    end if;
  end loop;

  raise notice 'leaves: %', array_to_string(v_leaves, ' | ');

  if v_mismatch <> '' then
    raise exception 'MISSING KEYS the admin page reads: %', v_mismatch;
  end if;

  -- And the reverse: nothing extra that would suggest a stale UI.
  if array_length(v_leaves, 1) <> coalesce(array_length(v_expected, 1), 0) then
    raise exception 'key count differs: db=% expected=%',
      array_to_string(v_leaves, ','), array_to_string(v_expected, ',');
  end if;

  raise notice 'STATS SHAPE MATCHES THE ADMIN PAGE';
end $$;