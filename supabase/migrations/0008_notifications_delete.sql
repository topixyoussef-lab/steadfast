-- ============================================================
-- 0008: staff delete on notifications
-- ============================================================
--
-- notifications had two policies from 0001, both own-rows: read for yourself
-- and update for yourself. There was no DELETE for anybody, not even the
-- owner, so a member could dismiss a notification by marking it read but never
-- clear the history. The console needs both: one row at a time, and every
-- notification a member has accumulated.
--
-- Two things here, because a DELETE policy alone is not enough.
--
-- The per-row policy follows 0007: DELETE only, scoped to staff. RLS
-- authorises a DELETE off the USING clause of the delete policy, so the write
-- in src/app/actions/admin.ts is authorised by this policy and nothing else.
--
-- The bulk clear is a SECURITY DEFINER function instead. Staff cannot read
-- another member's notifications by table: the only select policy is
-- notifications_own, and the dossier reaches them through the security-definer
-- get_admin_user_detail. So the action cannot count first to tell "deleted 40"
-- apart from "RLS denied and deleted 0", which is the silent no-op trap the
-- other actions in that file are written to avoid. Doing the delete and
-- returning the count in one definer call closes the trap without widening
-- read access to every notification row.
--
-- Additive and idempotent. Depends on 0001 only.

-- ============================================================
-- 1. Staff delete on notifications
-- ============================================================
drop policy if exists "notifications_admin_delete" on public.notifications;

create policy "notifications_admin_delete" on public.notifications
  for delete to authenticated
  using (private.is_admin());

-- ============================================================
-- 2. Clear every notification a member has
-- ============================================================
create or replace function public.admin_clear_notifications(p_user_id uuid)
  returns integer
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_deleted integer;
begin
  if not private.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Confirms the member exists. Without it a typo'd id would report zero
  -- deleted and read as success.
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'no such member' using errcode = 'P0002';
  end if;

  delete from public.notifications n
   where n.user_id = p_user_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.admin_clear_notifications(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_clear_notifications(uuid) to authenticated;
