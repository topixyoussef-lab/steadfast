-- ============================================================
-- 0010: admin broadcast notifications
-- ============================================================
-- The console gets a compose box that reaches a member or everyone as an
-- in-app notification (type 'system'), the same kind the 0002 triggers drop.
-- There is deliberately no INSERT policy on notifications, so this is the
-- only door the console can walk through: a security-definer function that
-- asks for the admin role, exactly like get_admin_members and the other
-- console reads.
--
-- Additive and idempotent.

create or replace function public.admin_broadcast_notifications(
  p_title  text,
  p_body   text default null,
  p_link   text default null,
  p_user_id uuid default null,
  p_type   text default 'system'
)
returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_title is null or char_length(trim(p_title)) = 0 then
    raise exception 'title required' using errcode = '22000';
  end if;
  if p_body is not null and char_length(p_body) > 2000 then
    raise exception 'message too long' using errcode = '22000';
  end if;

  -- p_user_id null means everyone; otherwise exactly the one profile. The
  -- caller (a server action) has already checked the staff role; this check
  -- is the second lock on the door, so a future action that forgets cannot
  -- broadcast by mistake.
  insert into public.notifications (user_id, type, title, body, link, metadata)
  select p.id, p_type, p_title, p_body, p_link,
         jsonb_build_object('source', 'admin')
    from public.profiles p
   where (p_user_id is null or p.id = p_user_id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_broadcast_notifications(text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_broadcast_notifications(text, text, text, uuid, text) to authenticated;