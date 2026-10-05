-- Repairs one specific hole: /community/<slug> answers 404 because the room row
-- the app links to is not in the database.
--
--   src/app/(app)/community/[slug]/page.tsx:40  -> notFound() when no row matches
--   src/components/shell/nav-links.tsx:19       -> "/community/main-hall"
--   src/app/(app)/community/page.tsx:41         -> the chat box needs slug
--                                                   'main-hall' by name
--
-- The rooms come from 0001_init.sql:819-825. A database seeded before that line
-- existed, or one where a room was deleted from the dashboard, has no such row,
-- and no later migration puts it back -- 0007/0008/0009 only touch columns,
-- attachments and triggers. So this file restates the seed rather than inventing
-- a new one.
--
-- Safe to run repeatedly and safe to run when nothing is broken: the INSERT is
-- byte-identical to the one in 0001 and ends in `on conflict (slug) do nothing`,
-- so an existing room keeps its id, its title edits and its messages. This file
-- never updates or deletes a row. The only thing it can do is add rooms that are
-- missing.
--
-- If a room already exists under a different slug and holds the history, do NOT
-- rename it here: moving a slug is an UPDATE and renaming a room people have
-- linked to is a decision, not a repair. Read the first result set, and if that
-- is the case, say so -- the choices are to point the app at the slug that
-- exists, or to move the messages to the new room, and those need the rows in
-- front of somebody.

-- What the database has now. This is the answer to "why does the link 404".
select r.slug, r.title, r.is_private,
       (select count(*) from public.chat_messages m
         where m.room_id = r.id)                    as messages,
       (select count(*) from public.chat_messages m
         where m.room_id = r.id and m.deleted_at is null) as visible
  from public.rooms r
 order by r.slug;

-- The 0001 seed, verbatim.
insert into public.rooms (slug, title, description) values
  ('main-hall',     'Main Hall',       'General recovery chat. Moderated 24/7.'),
  ('4am-support',   '4AM Support',     'For the nights when it gets hard.'),
  ('job-board',     'Job Board',       'Share work, find work. No cold approaches.'),
  ('introductions', 'Introductions',   'New here? Introduce yourself.'),
  ('victories',     'Victories',       'Streak milestones and small wins.')
on conflict (slug) do nothing;

-- The same read again, so the before/after difference is visible in one run.
select r.slug, r.title, r.is_private,
       (select count(*) from public.chat_messages m
         where m.room_id = r.id)                    as messages,
       (select count(*) from public.chat_messages m
         where m.room_id = r.id and m.deleted_at is null) as visible
  from public.rooms r
 order by r.slug;
