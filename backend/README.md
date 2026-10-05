# Steadfast moderation service

Async NLP moderation and panic-response service. Internal API, called only by the
Next.js route handlers with a shared secret.

## The one design rule

A recovery community has to be able to talk openly about the thing they are
recovering from. So naming the behaviour in your own recovery must never get you
blocked. `"I stopped masturbating after 30 days"` contains a word in the block
lexicon, and the engine still lets it through.

That is what the recovery-context rescue is for: the pipeline normalises the
text, matches the lexicon, then downgrades a block to a flag when the author is
framing it as their own recovery. It is enforced by tests
(`tests/test_moderation.py`) so a future lexicon edit cannot quietly break it.

Three categories are never rescued, because they are about other people or
about acute risk rather than the author's own progress:
`encouragement`, `solicitation`, `self_harm`.

No scripture is ever quoted. The responder offers a reflection prompt instead,
because quoting an ayah or verse from memory risks misattribution.

## Run

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements-dev.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

## Test

```bash
pytest -q
```

## Endpoints

| Method | Path        | Auth | Purpose                                     |
| ------ | ----------- | ---- | ------------------------------------------- |
| GET    | `/health`   | no   | Liveness. Also reports the active mode.     |
| POST   | `/moderate` | yes  | Score a chat message.                       |
| POST   | `/panic`    | yes  | Return a tiered supportive response.         |

Auth is the `X-API-Token` header, compared in constant time.

### `POST /moderate`

```json
{ "content": "day 12, feeling good", "user_id": "...", "room_id": "..." }
```

```json
{
  "decision": "allow",
  "severity": "info",
  "categories": [],
  "matched_terms": [],
  "reason": "No policy violation detected.",
  "engine": "lexicon",
  "latency_ms": 0.31,
  "request_id": "..."
}
```

`decision` is `allow`, `flag` or `block`. Only `block` means the row is never
written. `flag` stores the message with `is_flagged_by_ai` set for the admin
review queue. `413` for oversized bodies, `422` for empty ones.

`engine` is `lexicon`, `gemini` or `hybrid`, so you can tell from the response
whether a third party was consulted.

### `POST /panic`

```json
{ "urge_level": 9, "preference_type": "islamic", "current_streak": 21,
  "trigger": "loneliness", "timezone": "Asia/Riyadh" }
```

Returns `response`, ordered `steps`, `grounding` exercises, and
`escalate_to_admins`. Responses are tiered by urgency: the top tier directs
the member to emergency services and a real person, because this service is a
bridge and must never be the only support.

This service does **not** write to the database. The Next.js handler calls
`public.log_panic`, which also notifies admins. Keeping the Supabase
credentials out of this process is the point.

## Moderation modes

- `lexicon` (default) is local, free, deterministic, and has no network calls.
- `gemini` lets the model judge **every** message. The lexicon still runs
  first and it is what decides whenever Gemini is throttled, late,
  safety-filtered, or answers in a shape we cannot parse -- so a key that stops
  working degrades moderation to the old behaviour instead of stopping chat.
  Two rules hold this mode together:
  * a model `allow` never silently releases a message the lexicon hard-blocked.
    It becomes a `flag` tagged `model_overrode`, and a human still sees it.
  * `GEMINI_TIMEOUT_SECONDS` (2.0) must stay under the 4 s the Next.js client
    allows for the whole call. Past that the client aborts, `/api/moderate`
    fails closed, and the member cannot post. A verdict from the lexicon beats
    no verdict at all.
  After one failure the service stops asking for `GEMINI_COOLDOWN_SECONDS`
  (30), so a rate-limited key is not in every member's critical path.
  `gemini-flash-lite-latest` is the model that works on this project's key:
  correct verdicts on the sample set at ~900 ms, while `gemini-flash-latest`
  returned 503 high-demand and the numbered 2.5 models returned 404/429.
  The model's own free-text `reason` is parsed and kept for the log, but never
  shown to the member -- the composer displays the deterministic sentence.
- `hybrid` consults OpenAI only on messages the lexicon already flagged or
  blocked, and only if a key is set. It fails open to the lexicon verdict on
  timeout or error, so a slow third party can never block a member from
  posting. The model can also downgrade a block to a flag, tagged
  `model_overrode`.
- `openai` is not recommended for a safety-critical MVP.

`gemini` and the OpenAI paths are mutually exclusive: in `gemini` mode
`openai_enabled` is false, so a key left in the environment does not make the
service call two models per message.

## Evasion handling

`app/moderation/normalizer.py` folds leetspeak (`p0rn`), spaced-out letters
(`p o r n`), homoglyphs (Cyrillic `о` for Latin `o`), zero-width characters,
Arabic tatweel and diacritics. Character stuffing is caught by a second
`replace` pass that collapses repeated characters, so `p o o o r n` still
matches `porn`. Ordinary words are protected: `normalize` stops at two repeats
so `cool` is never mangled, and only the second pass squashes further.
