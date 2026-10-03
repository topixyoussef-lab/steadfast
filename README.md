# Steadfast

A recovery community: daily check-ins and streaks, moderated chat rooms, a
mutual-aid job board, and crisis escalation.

Privacy model: members are pseudonymous to each other. One name is chosen at
onboarding, and everything shown in chat is derived from that name, never from
an email address.

## Stack

| Layer     | Choice                                                  |
| --------- | ------------------------------------------------------- |
| Frontend  | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Styling   | Tailwind CSS 4 (`@theme` tokens, no config file)        |
| Database  | Supabase Postgres with row level security               |
| Auth      | Supabase Auth (GoTrue)                                  |
| Realtime  | Supabase Realtime channels                              |
| Backend   | Python FastAPI moderation service                       |

The frontend talks to Postgres **directly** through PostgREST. Every table is
protected by RLS, so the browser never bypasses access control. The only server
secret the app holds is the service role key, and it is used exclusively by the
moderation proxy.

## Layout

```
src/app/            routes, server actions, route handlers
src/components/     UI, grouped by feature
src/lib/            Supabase clients, DAL, python bridge
supabase/migrations SQL schema, applied in order
supabase/tests/     SQL assertions that run against a real database
backend/            FastAPI moderation service
```

## Setup

### 1. Frontend

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable                        | Source                                     |
| ------------------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Project Settings > API > Project URL        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings > API > publishable key    |
| `SUPABASE_SERVICE_ROLE_KEY`     | Project Settings > API > secret key         |
| `PYTHON_API_TOKEN`              | must equal `API_TOKEN` in `backend/.env`   |

The service role key bypasses RLS. It is read only in `src/lib/supabase/server.ts`
and must never be prefixed with `NEXT_PUBLIC_` or sent to the browser.

### 2. Database

Apply the migrations in order through the Supabase SQL editor, or:

```bash
supabase db push
```

1. `supabase/migrations/0001_init.sql` — tables, RLS policies, RPCs
2. `supabase/migrations/0002_job_loop.sql` — application triggers,
   notifications, the moderation notice trigger, and the admin member RPC

Both files are **not** safe to re-apply: `CREATE TYPE` has no `IF NOT EXISTS`
form in Postgres. Wrap the pair in a transaction if you want all-or-nothing.

Add yourself to the admin roster, otherwise `/admin` will never unlock:

```sql
insert into private.admin_emails (email) values ('you@example.com')
on conflict (email) do nothing;
```

### 3. Backend

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

`API_TOKEN` must match `PYTHON_API_TOKEN` in `.env.local`. Generate one with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 4. Run

```bash
npm run dev   # http://localhost:3001
```

## Moderation

The lexicon engine in `backend/app/moderation/lexicon.py` is deterministic,
local, and free. `MODERATION_MODE` also accepts `hybrid` (lexicon first,
OpenAI as a second opinion) or `openai`.

Detection is intent-based rather than keyword-based, which matters a great deal
here. Blocking the bare word `porn` would silence members describing a relapse,
and it would break anyone asking about medication. Purchase intent is matched
only in combination with a solicitation term, so `methadone`, `naloxone`, and
`rosary` stay allowed while `where can i buy p o o r n` is blocked.

Every chat write is moderated before it is stored. The composer sends to
`/api/moderate`, and only a permitted message reaches Postgres. Panic messages
bypass moderation by design and go straight to the crisis responder.

## Tests

```bash
# backend
cd backend && .\.venv\Scripts\python -m pytest -q

# frontend
npx tsc --noEmit
npm run lint
npm run build
```

The SQL suites are the interesting ones. They exercise triggers and RLS against
a real database rather than asserting against a mock. Point them at any local
Postgres and the script builds a throwaway database, applies
`scripts/harness.sql`, migrates, then runs the file:

```powershell
powershell -File scripts\verify-db.ps1 -Port 5432 supabase\tests\0002_job_loop_test.sql
powershell -File scripts\verify-db.ps1 -Port 5432 supabase\tests\0002_rls_test.sql
powershell -File scripts\verify-db.ps1 -Port 5432 supabase\tests\admin_stats_shape_test.sql
```

On PostgreSQL 10 the script rewrites `execute function` into
`execute procedure` first, because 10 only understands the older spelling. Pass
`-NoSubstitute` on 11 or newer. Each suite raises an exception and exits
non-zero on the first failed assertion, so it is safe to wire into CI.

## Security notes

- RLS is the access control boundary. Never reach for the service role key to
  work around a policy; that silently disables it.
- A write rejected by RLS returns no error and updates zero rows. Any action
  that must take effect re-selects the row and fails loudly instead.
- Applicants cannot set their own application status; a trigger enforces it.
- `private.admin_emails` is readable only by `private.is_admin`.