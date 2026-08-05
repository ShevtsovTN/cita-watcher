# Phase 9 dry run — outbound/inbound Watcher flow through a live `docker compose` stack

This is the runbook for `docs/APPLICATION_ROADMAP.md` Phase 9's first checklist item — create a
`WatchTask` via HTTP and verify it flows through to a notification — and, since its 2026-08-05
re-run below, also serves as `docs/NODE_WORKER_ROADMAP.md` Phase 6's first checklist item (the
Laravel side doesn't need its own separate runbook for the same round trip).

**Original run (2026-08-02):** node-worker didn't exist yet (`node-worker/src/index.ts` was still an
empty stub), so this runbook simulated it by hand with `redis-cli` at the one seam where it would
sit (steps 5 and 7 below). Every other step exercised real, running code.

**Re-run (2026-08-05):** node-worker's `messaging/`, `index.ts` wiring, and hardening (Phases 3-5 of
`NODE_WORKER_ROADMAP.md`) all exist now, so this run used the **real node-worker** for steps 5 and
7 instead of `redis-cli` — nothing in the flow is simulated anymore. See "Re-run with the real
node-worker" below for what was observed and a third real bug it found.

## Two bugs this dry run found and fixed (2026-08-02)

Running the actual stack — not just the PHPUnit suite, which runs against sqlite/sync and never
touches any of this — surfaced two real problems that had been sitting in the dev environment
undetected:

1. **`application/.env` had `QUEUE_CONNECTION=database`**, while `queue-worker` runs
   `php artisan queue:work redis --queue=watcher-commands` — an explicit `redis`-connection worker.
   Every `DispatchAvailabilityCheckJob` was silently landing in the `jobs` Postgres table instead
   and would sit there forever, un-processed. Fixed by setting `QUEUE_CONNECTION=redis` in
   `application/.env`.
2. **`event-consumer` had been running as bare `php-fpm` since Phase 5**, not
   `watcher:consume-events`. `docker-compose.yml`'s `command:` override for that service was
   uncommented back in Phase 5, but the running container was only ever `docker compose restart`ed
   afterwards — `restart` reuses a container's original startup config and does **not** pick up
   `command:`/other config changes from the compose file; only `docker compose up -d` recreates a
   container whose config actually changed. Fixed by running `docker compose up -d`, which
   recreated (only) `event-consumer`.

**Takeaway:** after editing anything in `docker-compose.yml`'s `command:`/`environment:` for a
service, run `docker compose up -d` (not `restart`) to actually apply it. `restart` looks like it
worked (no error) and is the easy trap.

## A finding worth keeping in mind: Redis keys/channels are prefixed

`config/database.php`'s redis `options.prefix` defaults to `Str::slug(APP_NAME)-database-`
(`env('REDIS_PREFIX', ...)`_). This prefix is applied by the phpredis client to **every** key and
pub/sub channel on that connection — including the ones `RedisWorkerGateway` and
`ConsumeWatcherEventsCommand` use. With this repo's default `.env` (`APP_NAME=Laravel`, no
`REDIS_PREFIX` override), the physical names are:

- Outbound list: `laravel-database-watcher-commands` (not the bare `watcher-commands` written in
  code/docs — that's the *logical* name; the prefix is applied transparently underneath it).
- Inbound pub/sub channel: `laravel-database-watcher-events`.

Confirmed via `redis-cli PUBSUB CHANNELS` while `event-consumer` was subscribed — it showed
`laravel-database-watcher-events`, not `watcher-events`. **node-worker's eventual ioredis client
needs to know the real prefixed names** (or `application/.env` needs `REDIS_PREFIX=` set to empty
for this to be the bare names) — this is new information for
`docs/NODE_WORKER_ROADMAP.md` Phase 3, not previously written down anywhere.

## Runbook

Run from the repo root. Assumes `docker compose -f cita-watcher-docker/docker-compose.yml up -d`
is already up.

1. **Issue a Sanctum token** (no login endpoint exists — see `APPLICATION_ROADMAP.md` Phase 7):
   ```bash
   docker compose -f cita-watcher-docker/docker-compose.yml exec -T app php artisan tinker --execute="
   \$user = App\Infrastructure\Persistence\Models\User::factory()->create(['email' => 'dryrun@example.test']);
   echo \$user->createToken('dry-run')->plainTextToken;
   "
   ```

2. **Create a WatchTask via the real HTTP API** (through nginx, port from `cita-watcher-docker/.env`'s
   `APP_PORT`, default 8080):
   ```bash
   curl -s -X POST http://localhost:8080/api/watch-tasks \
     -H "Authorization: Bearer <token from step 1>" \
     -H "Accept: application/json" -H "Content-Type: application/json" \
     -d '{"province":"Madrid","tramiteCode":"CITA_DNI","fullName":"Dry Run","documentId":"00000000A","email":"dryrun@example.test","phone":"600000000","notificationChannel":"mail","notificationTarget":"dryrun@example.test"}'
   ```
   Expect `201` and a body with `documentId` absent (Phase 7's `WatchTaskResource`). Note the
   returned `id`.

3. **Trigger the scheduled dispatch immediately** (rather than waiting up to 5 minutes for
   `scheduler`'s `everyFiveMinutes()`):
   ```bash
   docker compose -f cita-watcher-docker/docker-compose.yml exec -T app php artisan watcher:dispatch-due-checks
   ```
   Expect `queue-worker`'s logs (`docker compose logs queue-worker --tail=5`) to show
   `DispatchAvailabilityCheckJob ... DONE`, and the WatchTask's status to be `running`:
   ```bash
   docker compose -f cita-watcher-docker/docker-compose.yml exec -T app php artisan tinker --execute="echo App\Infrastructure\Persistence\Models\WatchTask::find(<id>)->status->value;"
   ```

4. **Confirm the outbound command actually landed in Redis** (real `RedisWorkerGateway` output —
   this is what node-worker would eventually `BRPOP`):
   ```bash
   docker compose -f cita-watcher-docker/docker-compose.yml exec -T redis redis-cli LRANGE laravel-database-watcher-commands 0 -1
   ```
   Expect one JSON `WorkerCommand` with `type: "check_availability"`, the right `watchTaskId`,
   `procedure`, `applicant` (including plaintext `documentId` — expected, node-worker needs it to
   fill the real form; see Phase 6's scope-boundary notes), and a `commandId` UUID.

5. **Simulate node-worker's result** by publishing directly to the inbound channel:
   ```bash
   docker compose -f cita-watcher-docker/docker-compose.yml exec -T redis redis-cli PUBLISH laravel-database-watcher-events \
     '{"type":"check_completed","watchTaskId":<id>,"slots":[{"dateTime":"2026-08-10T10:00:00+00:00","office":"Madrid Office"}],"checkedAt":"2026-08-02T14:00:00+00:00"}'
   ```
   Returns `1` (one subscriber received it — `event-consumer`).

6. **Confirm the WatchTask state updated**:
   ```bash
   docker compose -f cita-watcher-docker/docker-compose.yml exec -T app php artisan tinker --execute="echo App\Infrastructure\Persistence\Models\WatchTask::find(<id>)->status->value;"
   ```
   Expect `completed`.

7. **Confirm the notification actually fired** (`MAIL_MAILER=log` in this `.env`, so no real
   credentials needed — the "sent" email is written straight to the log):
   ```bash
   docker compose -f cita-watcher-docker/docker-compose.yml exec -T app tail -n 20 storage/logs/laravel.log
   ```
   Observed in this run:
   ```
   [...] local.DEBUG: From: Laravel <hello@example.com>
   To: dryrun@example.test
   [...]
   Appointment slots found:
   2026-08-10 10:00 at Madrid Office {"watch_task_id":<id>,"command_id":null}
   [...] local.INFO: Handled a worker event. {"watch_task_id":<id>,"command_id":null,"type":"check_completed"}
   ```
   `command_id` is `null` here because the synthetic step-5 payload didn't echo the `commandId`
   from step 4 — a real node-worker doing so would make it correlate end-to-end; see the note in
   `RedisWorkerGateway`'s docblock.

8. **Clean up** the dry-run `User`/`WatchTask`/token via `tinker` (`->delete()` on each) — this
   runbook's steps create real rows in the dev database.

*(Steps 5 and 7 above simulated node-worker by hand, since it didn't exist on 2026-08-02. Kept
as-written for the record and as a still-useful fallback for exercising the Laravel side in
isolation. See below for what actually happened once a real node-worker existed to do those steps
itself.)*

## Re-run with the real node-worker (2026-08-05)

node-worker's `messaging/`/`index.ts`/hardening (`NODE_WORKER_ROADMAP.md` Phases 3-5) all exist now,
so this re-run repeated steps 1-4 unchanged, then let the **real** node-worker do what steps 5 and 7
used to simulate:

- **Step 5' (real):** instead of a manual `redis-cli PUBLISH`, just waited — `node-worker`'s
  `RedisCommandConsumer` had already `BRPOP`ed the command within milliseconds of step 3/4 (its
  `BRPOP` connection is visible live via `redis-cli CLIENT LIST`, see `NODE_WORKER_ROADMAP.md`
  Phase 4), launched a real headless Chromium session, and actually navigated to the real site.
- **Step 7' (real):** node-worker's own logs (`docker compose logs node-worker`) showed the full,
  correlated real outcome:
  ```
  [node-worker] check crashed with an unexpected error, publishing a retryable check_failed
  command_id=1293e7b9-... watch_task_id=2 reason=Unexpected error: Trámite
  "POLICIA-ASIGNACIÓN DE NIE" was not found in either select on this province's page
  [node-worker] published worker event command_id=1293e7b9-... watch_task_id=2
  type=check_failed retryable=true
  ```
  This is a genuine, informative result, not a failure of the dry run: `POLICIA-ASIGNACIÓN DE NIE`
  was only ever a guessed trámite label (see `command-handler.test.ts`'s own fixture) — no exact
  real `<select>` option text has been confirmed and recorded anywhere in the codebase since Phase
  1's live reconnaissance. What this *does* confirm, for real: outbound network reachability from
  the `node-worker` container to `icp.administracionelectronica.gob.es` works, the real province
  page loads and its trámite `<select>`s get parsed, `TramiteNotFoundError` is thrown when the
  guessed label doesn't match, and Phase 5's new catch-all in `command-handler.ts` handles that
  exactly as designed — a retryable `CheckFailedEvent`, not a stuck `WatchTask` or a crashed
  process. Laravel's `event-consumer` received and handled it (`Log`: `"Handled a worker event."
  {"watch_task_id":2,"type":"check_failed"}`), and the `WatchTask` correctly went back to `pending`
  (`HandleCheckFailedUseCase`'s retryable path) — confirmed again a few minutes later when the
  *scheduler's own* `everyFiveMinutes()` tick re-dispatched the same still-pending `WatchTask`
  automatically, with the identical outcome, with no manual trigger at all.
- **Finding a real trámite label** (so a future run can get further — past province/trámite
  selection into the actual applicant form, Cl@ve panel, or WAF) is real recon work of the same
  kind Phase 1 already did for provinces/countries, not attempted here — guessing at more labels
  without confirming them against the live page first would just be repeating the mistake once, not
  fixing it.

### A third bug this re-run found and fixed: `event-consumer` was crash-looping on Redis's default read timeout

Checking `event-consumer`'s logs turned up something unrelated to node-worker entirely: `docker
inspect`'s `RestartCount` was 48, and `storage/logs/laravel.log` had **150** occurrences of
`RedisException: read error on connection to redis:6379` going back to 2026-08-04 15:26 — the
service had been silently crash-looping for the better part of a day, on a cadence that (once
isolated to its tightest recent run) was almost exactly every 60 seconds
(`12:59:31 → 13:00:32 → 13:01:32 → 13:02:52 → 13:03:53`).

**Root cause:** `ConsumeWatcherEventsCommand::handle()` calls `Redis::subscribe()`, which holds one
sustained blocking read on the TCP connection until a message arrives — fundamentally different
from `queue:work redis`'s own driver, which polls with a *bounded* `BLPOP` internally even with
`block_for: null` in `config/queue.php` (confirmed: `queue-worker` had zero restarts and zero read
errors the entire time). `config/database.php`'s `redis.default` connection never set a
`read_timeout`, so phpredis fell back to PHP's `default_socket_timeout` ini default — 60 seconds.
Once `watcher-events` sat idle for 60s (the common case outside an active dry run), the blocking
read timed out, phpredis surfaced it as a `RedisException`, `Redis::subscribe()`'s callback-based
API has no built-in reconnect, so the whole `watcher:consume-events` process exited — and Docker's
`restart: unless-stopped` just kept restarting it into the same wall every ~60s, forever, silently.

**Fix:** `'read_timeout' => env('REDIS_READ_TIMEOUT', -1)` added to `config/database.php`'s
`redis.default` block — `-1` tells phpredis to block indefinitely, which is what a `SUBSCRIBE` loop
is actually supposed to do. Safe for `default`'s other two consumers (`RedisWorkerGateway`'s
`RPUSH`, `queue:work`'s already-bounded polling) since neither depends on an idle-read timeout to
function. **Verified, not just theorized:** restarted `event-consumer`, then watched
`storage/logs/laravel.log` for over 7 minutes (well past the old ~60s trigger interval, repeatedly)
with zero new `RedisException` entries and `RestartCount` staying at 0 — a clean break from the
"every ~60s" pattern observed immediately beforehand.

*(One red herring encountered while verifying this: a `docker events`-visible `SIGKILL`
kill/restart of the `event-consumer` container ~40s after the fix, initially mistaken for the bug
recurring. It wasn't — cross-checking against `storage/logs/laravel.log`'s actual `RedisException`
signature showed no new entry at that timestamp, meaning that particular restart was an external
kill/restart of the container, not an internal crash. Worth remembering: a container restart alone
doesn't prove a bug reappeared — check the actual in-process error signature, not just container
lifecycle events.)*

## Manual browser recon (2026-08-05): a real trámite label, a real captcha, and the real booking flow

The dry run above left "finding a real trámite label" as unstarted recon. Automated recon from
this dev environment turned out to be blocked anyway: outbound HTTPS to
`icp.administracionelectronica.gob.es` from inside the `node-worker` container hit a **FortiGate
Intrusion Prevention** block at the local network level (not the site's own WAF — a plain `curl`
to the target failed identically, with a MITM'd/untrusted TLS cert, and even unrelated domains
wouldn't resolve without going through the same proxy). Nothing about that is specific to this
project; it's a constraint of the network this dev environment happened to run on.

Instead, a human walked the live site directly in a real browser (outside that network's
restrictions) and reported back what happened at each step, in words, rather than automating
anything. This is **not** a node-worker-verified result — no node-worker code ran during this
recon — but it does resolve real unknowns that blocked Phase 1 through Phase 6 for a long time:

- **Confirmed real trámite labels for two provinces.** Cuenca (`icpplus`, `p=16`) has a full
  extranjería + policía trámite list, including `POLICIA - RECOGIDA DE TARJETA DE IDENTIDAD DE
  EXTRANJERO (TIE)` and `POLICÍA-TOMA DE HUELLAS (EXPEDICIÓN DE TARJETA) INICIAL, RENOVACIÓN,
  DUPLICADO Y LEY 14/2013`. Alicante (`icpco`, `p=3`) only offers policía trámites, with the same
  two options plus `POLICÍA TARJETA CONFLICTO UCRANIA`. Selecting `POLICÍA-TOMA DE HUELLAS` for
  Alicante/Benidorm produced `RequiresClave` for real (landed on
  `https://pasarela.clave.gob.es/Proxy2/ServiceProvider`) — the first live confirmation that
  trámite-level Cl@ve gating, previously only a comment in `site-navigator.ts`, is real behavior.
- **`POLICIA - RECOGIDA DE TARJETA DE IDENTIDAD DE EXTRANJERO (TIE)` for Alicante/"CNP Benidorm
  TIE" went all the way through** — past the applicant form, past a captcha, to real slot data.
  This is the first trámite this project has ever confirmed doesn't dead-end at Cl@ve or the WAF.
- **The real flow is a 5-step wizard**, materially different from what `site-navigator.ts`'s
  `runAvailabilityCheck` currently models (province/trámite select → applicant form → one
  `PostSubmitUnconfirmed` outcome). What actually happens after the applicant form
  (`acEntrada`/`acValidarEntrada`):
  1. An options menu (Solicitar Cita / Consultar Citas Confirmadas / Consultar Citas Expediente /
     Anular Cita) — the site recognizing an existing "expediente" tied to the submitted NIE before
     it'll let you book, which makes sense specifically for a *recogida* (pickup) trámite.
  2. `acCitar`, labeled "Paso 2 de 5": phone number + email (with repeat-email confirmation),
     required.
  3. `acOfertarCita`, "Paso 3 de 5": a real list of offered slots (three were returned, with real
     dates/times a few days out) **and, for the first time in this project, a real captcha** — the
     site's own `eu-captcha` widget, a plain ~6-character alphanumeric image challenge with an
     audio alternative and a reload link. Nothing exotic — exactly the "human reads an image, types
     text" shape the `captcha/` module's screencast+input relay was already designed around. A
     visible on-page countdown starts here: **"DISPONES DE 5 MINUTOS PARA COMPLETAR LA
     CONFIRMACIÓN DE ESTA CITA."**
  4. `acVerificarCita`, "Paso 4 de 5": a review screen echoing back everything submitted (identity,
     phone, email, office, date/time, "Mesa") plus a required "Estoy conforme..." checkbox and a
     GDPR notice, submitting to `acGrabarCita`.
  5. `acGrabarCita` — the actual commit. **Not cleanly observed**: by the time step 4 was submitted,
     the 5-minute window from step 3 had elapsed. The submit didn't error — it silently no-opped and
     bounced back to province selection, with no reservation made. This confirms the 5-minute
     window is a real, server-enforced constraint, not just decorative UI: **a human solving a
     relayed captcha has to get through slot selection, captcha entry, and the review screen in
     well under 5 minutes, or the whole attempt is lost with no error signal at all.**
- **The applicant-identity form's fields are trámite-dependent, not fixed.** This trámite's form
  asked only for a N.I.E. field and "Nombre y apellidos" — no birth year, no nationality select,
  and only one document-type radio (N.I.E.), not the three (N.I.E./D.N.I./PASAPORTE) `site-navigator
  .ts`'s `fillApplicantForm` unconditionally handles today. Run as-is against this real page, that
  function would hang or throw looking for `getByLabel("Año de nacimiento")` /
  `getByLabel("País de nacionalidad")`, neither of which exists on this trámite's form.

**Not done by this recon, deliberately:** no node-worker code was exercised against any of this —
`site-navigator.ts` still only models the old single-shot shape. Modeling the 5-step wizard (and
making the applicant-form step trámite-aware) is real follow-up implementation work, out of scope
for a documentation pass. See `../docs/NODE_WORKER_ROADMAP.md` Phase 6 for the roadmap-level
pointer to this same finding.

## Not covered by this runbook

- **`check_failed` (retryable and terminal) and `captcha_required`** — same mechanism as step 5,
  just a different `type`/payload (see `WorkerEventRouter`); not re-verified live here since
  `WorkerEventRouterIntegrationTest` and `HandleCheckFailedUseCaseTest` already cover both paths
  against a real DB and the real Illuminate event dispatcher. (The 2026-08-05 re-run did exercise a
  real `check_failed{retryable: true}` live, incidentally — see above — but `check_completed`/
  `captcha_required`/`check_failed{retryable: false}` still rely on those tests, not a live run;
  the manual browser recon just above confirms real slot data and a real captcha exist to be found
  by a future node-worker-driven run, not that node-worker itself has produced either event yet.)
- **The manual captcha-solving walkthrough** (`APPLICATION_ROADMAP.md` Phase 9's second checklist
  item / `NODE_WORKER_ROADMAP.md` Phase 6's second checklist item) — blocked on node-worker's
  `captcha/` CDP relay ever actually binding a session (`CaptchaSessionRegistry.register()` still
  has no caller) and a human-facing UI for the screencast, which is explicitly not designed yet and
  out of scope for the Laravel side (see
  the root `CLAUDE.md`'s non-goals). Not attempted; not achievable until both of those exist.
