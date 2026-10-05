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
assets/brand/       source artwork every icon surface is generated from
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
local, and free. `MODERATION_MODE` also accepts `gemini` (the model judges every
message and the lexicon decides whenever the model is unavailable), `hybrid`
(lexicon first, OpenAI as a second opinion) or `openai`. See
`backend/README.md` for what each mode guarantees.

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

## Icons and the installable app

Every icon surface derives from one square artwork file, kept in the repo at
`assets/brand/fist.jpeg` (1024x1024, the crop box below is measured against that
size). With no argument both generators read it from there:

```bash
node scripts/generate-icons.mjs                       # or: … <path-to-artwork>
```

That rewrites the manifest icons (plain and maskable), `apple-icon.png`,
`favicon.ico`, `icon.svg`, and `public/icons/brand-mark.png`, which the header
and the landing page render. Small sizes use a cropped, tone-steepened variant of
the artwork; the full composition collapses into an unreadable smudge at 16 px.
After regenerating, bump the cache name in `public/sw.js` or installed PWAs keep
serving the old icons.

The Android wrapper is a Bubblewrap TWA project living outside this repository at
`D:\tmp\twa`. To rebuild the APK with new artwork:

```bash
node scripts/generate-apk-icons.mjs "D:/tmp/twa"       # or: … <artwork> <dir>
```

then edit `versionCode`/`versionName` in `D:\tmp\twa\app\build.gradle` and run
`npx @bubblewrap/cli build --skipPwaValidation` from that directory. The CLI asks
for the version and keystore answers as it goes; `D:\tmp\twa\build-noninteractive.js`
drives the same `build()` with a fake prompter that supplies them. Two
environment traps: `bubblewrap` takes its JDK from
`C:\Users\PC\.bubblewrap\config.json` and ignores an exported `JAVA_HOME`, and
that path must be a full JDK (`javac.exe` present) rather than a JRE; and the
Gradle plugin refuses to start when `ANDROID_HOME` and `ANDROID_SDK_ROOT` name
different SDKs. The build does not regenerate icon resources — only
`generate-apk-icons.mjs` does, and it also refreshes `store_icon.png` so a later
`bubblewrap update` cannot restore the old art.

After every build, confirm the manifest URL in the artifact points at the
deployment, not at a dev server:

```bash
aapt2 dump resources public/steadfast.apk | findstr /A:2 "string/webManifestUrl"
```

It must read `https://<host>/manifest.webmanifest`. Android Browser Helper uses
that URL to fetch the web manifest and build the WebAPK on the device; a
`http://localhost:<port>` value (which is what `bubblewrap update` writes when a
local dev server is running) is unreachable from a phone, the WebAPK never
builds, and every launch silently falls back to a Custom Tab — the app opens
with a browser toolbar across the top instead of the web app full screen.

Copy the result into the repo and release it like any other asset:

```bash
cp /d/tmp/twa/app-release-signed.apk public/steadfast.apk
```

Keep the signing keystore in `C:\Users\PC\.steadfast-signing` and reuse it. A new
certificate produces an APK that cannot update the installed app in place. Never
commit a build log: `bubblewrap` echoes the `jarsigner` command line, which
contains the keystore password in plaintext.

## Deploying

The Vercel project is **not** connected to GitHub, so pushing to `main` deploys
nothing. Releasing is one script, which deploys and then moves the live hostname
onto the deployment it just made:

```powershell
powershell -File scripts\deploy.ps1
```

`steadfast-lake-eta.vercel.app` is the only hostname the TWA, `assetlinks.json`
and the web manifest point at, and Vercel will not move it by itself: a fresh
production deployment claims only `steadfast-velo6.vercel.app` and leaves the
real domain frozen on the previous build, so the APK download and every other
asset silently stay a release behind. Declaring the alias in `vercel.json` does
not help — the CLI ignores that key and claims nothing, without saying so. That
is how a fixed APK sat on `main` for hours while the domain kept serving the
build before it, so `deploy.ps1` assigns the alias explicitly and then reads the
APK back off the domain to confirm the length matches what was committed. A
mismatch exits non-zero: a stale alias still answers `200`, so the status code
on its own proves nothing.

## Security notes

- RLS is the access control boundary. Never reach for the service role key to
  work around a policy; that silently disables it.
- A write rejected by RLS returns no error and updates zero rows. Any action
  that must take effect re-selects the row and fails loudly instead.
- Applicants cannot set their own application status; a trigger enforces it.
- `private.admin_emails` is readable only by `private.is_admin`.