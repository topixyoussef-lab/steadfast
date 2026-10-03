-- ============================================================
-- 0003: consolidated admin member dossier
-- ============================================================
--
-- The console needs to answer "everything about this one member" in a single
-- round trip. Doing that with ordinary table reads is not possible: the row
-- level policies for check-ins, task completions, notifications and job
-- applications are deliberately own-rows-only, so staff cannot see another
-- member's data no matter how the query is written.
--
-- Rather than loosening those policies (which would widen every other query in
-- the product too), this adds one security-definer function that returns the
-- whole dossier as jsonb. It is the single audited surface for staff reads of
-- member data, it re-checks the caller on every invocation, and `search_path`
-- is pinned so nothing can be shadowed.
--
-- SECURITY NOTE: because this is SECURITY DEFINER it runs as the function
-- owner and therefore bypasses row level security entirely. That is the point
-- -- it is the only way to see soft-deleted chat messages and another member's
-- check-in notes -- but it also means the `private.is_admin()` check at the top
-- is the *only* thing standing between a caller and every row in the database.
-- Do not add parameters, joins or output keys to this function without putting
-- the guard through the same review.
--
-- List sections are capped. A dossier is a review screen, not an export.

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
  -- Identity is the phone number. The confirmation/recovery timestamps that
  -- used to be reported here are email-delivery bookkeeping and are always null
  -- for phone accounts, so they are gone rather than shown as broken.
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