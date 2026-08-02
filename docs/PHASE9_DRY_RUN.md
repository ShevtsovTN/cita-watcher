# Phase 9 dry run — outbound/inbound Watcher flow through a live `docker compose` stack

This is the runbook for `docs/APPLICATION_ROADMAP.md` Phase 9's first checklist item: create a
`WatchTask` via HTTP and verify it flows through to a notification. **node-worker doesn't exist yet**
(`node-worker/src/index.ts` is still an empty stub — see `docs/NODE_WORKER_ROADMAP.md`), so this
runbook simulates it by hand with `redis-cli` at the one seam where it would sit. Every other step
exercises real, running code — nothing here is mocked.

Re-run this after node-worker's messaging module (`NODE_WORKER_ROADMAP.md` Phase 3) actually exists,
replacing steps 5 and 7 with "wait for the real node-worker to do it" instead of a manual
`redis-cli` command — if the real thing produces the same observable results this runbook checks
for, the contract held.

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

## Not covered by this runbook

- **`check_failed` (retryable and terminal) and `captcha_required`** — same mechanism as step 5,
  just a different `type`/payload (see `WorkerEventRouter`); not re-verified live here since
  `WorkerEventRouterIntegrationTest` and `HandleCheckFailedUseCaseTest` already cover both paths
  against a real DB and the real Illuminate event dispatcher.
- **The actual browser automation** against `sede.administracionespublicas.gob.es` — that's
  node-worker's `automation/` module (`NODE_WORKER_ROADMAP.md` Phase 1), which doesn't exist.
- **The manual captcha-solving walkthrough** (`APPLICATION_ROADMAP.md` Phase 9's second checklist
  item) — blocked on node-worker's `captcha/` CDP relay (`NODE_WORKER_ROADMAP.md` Phase 2) and a
  human-facing UI for the screencast, which is explicitly not designed yet and out of scope for the
  Laravel side (see the root `CLAUDE.md`'s non-goals). Not attempted; not achievable until both of
  those exist.
