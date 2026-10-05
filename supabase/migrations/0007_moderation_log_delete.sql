-- ============================================================
-- 0007: moderation log admin delete
-- ============================================================
--
-- moderation_log carried a SELECT policy for staff from 0001 and no write
-- policy at all, so rows could be read but never removed. The console needs
-- to clear entries it has finished with, otherwise the list only ever grows.
--
-- Deliberate limits:
--
--  1. DELETE only. No INSERT, UPDATE or TRUNCATE. The log is written by the
--     service_role key from the Next.js route handlers, and this policy must
--     never become a way for a browser client to author history.
--  2. `private.is_admin()` matches the rest of the console: it is true for
--     both admin and moderator, the two roles requireStaff() lets in.
--  3. The action in src/app/actions/admin.ts runs on the user client, not
--     service_role, so this policy is the thing that actually authorises the
--     delete and a mis-scoped policy fails closed instead of bypassing it.
--
-- Deleting a row here removes the audit record. moderation_log.content_preview
-- is a copy of the message text, so removing the row also removes the last
-- trace of what the AI judged. That is the point of a purge button, but it is
-- worth knowing before anyone uses it.
--
-- Additive and idempotent. Depends on 0001 only.

-- ============================================================
-- 1. Staff delete on the moderation log
-- ============================================================
drop policy if exists "moderation_log_admin_delete" on public.moderation_log;

create policy "moderation_log_admin_delete" on public.moderation_log
  for delete to authenticated
  using (private.is_admin());
