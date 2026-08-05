# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Cita Watcher automates checking `sede.administracionespublicas.gob.es` (a Spanish government
appointment-booking site) for available appointment slots, and relays a live browser view over
WebSocket so a human can solve captchas manually when the automated flow hits one.

The repo is a monorepo with three independent parts, each with its own toolchain and its own
`CLAUDE.md` with part-specific guidance:

- `application/` — Laravel 13 (PHP 8.4) app: orchestrates watch tasks, persists state, dispatches
  commands to the worker, and (eventually) consumes result events. See `application/CLAUDE.md`.
- `node-worker/` — TypeScript + Playwright worker: drives a real browser against the target site
  and exposes a CDP screencast relay over WebSocket for manual captcha solving. See
  `node-worker/CLAUDE.md`.
- `cita-watcher-docker/` — Dockerfiles, nginx config, and the `docker-compose.yml` that wires
  everything together for local/dev/prod runs. See `cita-watcher-docker/CLAUDE.md`.

**Project stage:** on the Laravel side, `Domain/Watcher`, `Infrastructure/Watcher`,
`Application/Watcher`, and `Presentation` are fully implemented through Phase 8 of
`docs/APPLICATION_ROADMAP.md`: outbound command dispatch to node-worker (Phase 4 —
`RedisWorkerGateway`, `DispatchAvailabilityCheckJob`, the scheduled `watcher:dispatch-due-checks`
command), inbound event consumption from node-worker (Phase 5 — the `watcher:consume-events`
artisan command, `WorkerEventRouter`, and the `HandleCheckCompletedUseCase`/
`HandleCaptchaRequiredUseCase`/`HandleCheckFailedUseCase` use cases), applicant data encryption at
rest (Phase 6 — `ApplicantDataEncryptorInterface` → `LaravelApplicantDataEncryptor`;
`watch_tasks.applicant_data` is one `APP_KEY`-encrypted column, not plain per-field columns), a
`WatchTask` HTTP API (Phase 7 — `WatchTaskController` under `routes/api.php`, protected by
`laravel/sanctum`; token-only, no login/registration endpoint exists — tokens are issued
operationally via `php artisan tinker`), and hardening/observability (Phase 8 — retryable vs.
terminal `CheckFailedEvent` handling via `WatchTask::retry()`, a `maxConcurrentSessions` dispatch
guard, `watch_task_id`/`command_id` log correlation) all now exist and are wired up in
`docker-compose.yml`. Phase 9 (integration verification) is partially done: the outbound/inbound
flow was dry-run through a live stack with node-worker simulated by hand via `redis-cli` — see
`docs/PHASE9_DRY_RUN.md`, including two real dev-stack bugs that dry run found and fixed. The
manual captcha-solving walkthrough is genuinely blocked (needs node-worker's CDP relay and an
undesigned UI), not just deferred. On the node-worker side, `messaging/` (Phase 3 of
`docs/NODE_WORKER_ROADMAP.md`) now exists and implements both directions of the Redis contract —
`RedisCommandConsumer`/`parseWorkerCommand` consuming `WorkerCommand` (including `commandId`) off
the `watcher-commands` list, and `RedisEventPublisher` publishing `CheckCompletedEvent`/
`CaptchaRequiredEvent`/`CheckFailedEvent` (including `check_failed`'s `retryable`) onto
`watcher-events` — tested against hand-built fakes plus one real-Redis integration test. The
`ApplicantData` wire shape was extended in lockstep on both sides (`documentType`/`birthYear`/
`nationality`) to match what the real applicant form needs. `node-worker/src/index.ts` (Phase 4)
is no longer a stub either — it now wires `automation/`/`captcha/`/`messaging/` into an actual
running process (session manager, two dedicated Redis connections, command consumer, WS relay,
graceful shutdown, top-level error handling), verified manually against the live `docker-compose`
dev stack (BRPOP connection alive, invalid WS tokens rejected with close code 4400). Phase 5
(hardening/observability) is also done: node-worker now has structured, correlated logging
(`command_id`/`watch_task_id`, matching Laravel's own `Log::withContext()` field names so both
services' logs are grep-able by the same keys), publishes a `retryable: true` `CheckFailedEvent` on
an uncaught exception instead of silently dropping the command, and exposes an HTTP health endpoint
(`HEALTH_PORT`) backing a `docker-compose` `healthcheck:` on the `node-worker` service. What's still
*not* confirmed end-to-end is a real Laravel-dispatched command actually being picked up and
resulting in a published event back on `watcher-events` under real conditions — that's Phase 6 of
`docs/NODE_WORKER_ROADMAP.md` (integration verification), not yet done; today's dev stack has never
been driven with a real `WatchTask`, only Phase 9's `redis-cli`-simulated dry run predating
node-worker's own implementation. Check the relevant roadmap (`docs/APPLICATION_ROADMAP.md`,
`docs/NODE_WORKER_ROADMAP.md`) before assuming a later
phase's piece exists.

## Cross-service architecture

Read the header comment in `cita-watcher-docker/docker-compose.yml` first — it's the
authoritative description of how the services talk to each other. Summary:

- **nginx** serves Laravel's `public/` and reverse-proxies `/captcha-ws/` (WebSocket) straight to
  `node-worker:4001`. The node-worker validates a session token embedded in the path itself and
  binds the connection to the right CDP/Chromium session — nginx does no auth.
- **app** (php-fpm) is the Laravel application.
- **queue-worker** runs `php artisan queue:work redis --queue=watcher-commands` — this is the
  outbound direction: Laravel → node-worker commands.
- **event-consumer** runs `php artisan watcher:consume-events`, subscribing to the single
  `watcher-events` Redis pub/sub channel (`CheckCompleted` / `CaptchaRequired` / `CheckFailed`,
  distinguished by a `type` field) — the inbound direction: node-worker → Laravel. Laravel's side
  is implemented; node-worker doesn't publish to this channel yet (its `messaging/` module is still
  Phase 3 of `docs/NODE_WORKER_ROADMAP.md`).
- **scheduler** runs `php artisan schedule:work`.
- **node-worker** is Playwright + the CDP screencast relay; it owns real browser sessions and does
  the actual site automation.
- **redis** carries both the command queue and the event pub/sub between Laravel and node-worker.
  Both are Redis-client-prefixed (`config('database.redis.options.prefix')`, default
  `Str::slug(APP_NAME)-database-`) — the physical key/channel names are `laravel-database-watcher-commands`/
  `laravel-database-watcher-events` with this repo's default `.env`, not the bare
  `watcher-commands`/`watcher-events` used as their logical names throughout the code and docs. See
  `docs/PHASE9_DRY_RUN.md`.
- **db** is Postgres, holding watch tasks, logs, and encrypted applicant data.

Two separate `.env` files exist and are not interchangeable:

- `cita-watcher-docker/.env` — variables for docker-compose substitution only (e.g. `DB_PASSWORD`,
  `APP_PORT`, `DOCKER_UID`/`DOCKER_GID`).
- `application/.env` — Laravel's own runtime config, read from the bind-mounted app directory; it
  is deliberately not wired up via compose's `env_file`.

## Where to look next

- Working on Laravel code (Domain/Application/Infrastructure/Presentation, DDD/SOLID conventions,
  `composer`/`artisan`/`pint` commands)? → `application/CLAUDE.md`.
- Working on the Playwright/CDP worker (TypeScript conventions, `config.ts` pattern, `npm`
  commands)? → `node-worker/CLAUDE.md`.
- Working on Docker Compose, nginx, or service wiring/env files? → `cita-watcher-docker/CLAUDE.md`.