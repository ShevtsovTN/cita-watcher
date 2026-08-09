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
flow was dry-run twice through a live stack — first (2026-08-02) with node-worker simulated by hand
via `redis-cli`, then for real (2026-08-05) once node-worker actually existed, no simulation left
anywhere in the flow — see `docs/PHASE9_DRY_RUN.md` for both runs, including three real dev-stack
bugs found and fixed across them (the third: `event-consumer` had been silently crash-looping for
almost a day on a Redis `read_timeout` default, unrelated to node-worker itself — see
`config/database.php`'s `redis.default.read_timeout`). The manual captcha-solving walkthrough is
still genuinely blocked (needs node-worker's CDP relay to ever actually bind a session, plus an
undesigned UI), not just deferred — though a real captcha has since been observed by hand outside
node-worker entirely; see the recon note below. On the node-worker side, `messaging/` (Phase 3 of
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
(`HEALTH_PORT`) backing a `docker-compose` `healthcheck:` on the `node-worker` service. A real
Laravel-dispatched command being picked up and resulting in a published event back on
`watcher-events` under real conditions — `docs/NODE_WORKER_ROADMAP.md` Phase 6's first item — is
now confirmed live (see the dry-run note above): the actual site was reached over the network and a
real `TramiteNotFoundError` (a guessed trámite label, never confirmed against the live page) was
correctly turned into a retryable `CheckFailedEvent` by node-worker's Phase 5 catch-all. A real
trámite label, a real slot listing, and — for the first time in this project — a real captcha have
since all been confirmed to exist, by a human walking the live site directly in a browser
(2026-08-05, `docs/PHASE9_DRY_RUN.md`'s "Manual browser recon" section): `POLICIA - RECOGIDA DE
TARJETA DE IDENTIDAD DE EXTRANJERO (TIE)` in Alicante reaches a real, simple ~6-character
alphanumeric image captcha and real offered slots, three-plus steps past what node-worker's
`site-navigator.ts` currently models (a 5-step wizard — options menu → phone/email →
slots+captcha, under a hard server-enforced 5-minute window → review → commit — not the
single-shot form the code assumes). That recon session itself ran no node-worker code, but the same
day, as scoped follow-up work, `site-navigator.ts` was extended to actually model the first three
of those five wizard steps (options menu → `acCitar` → `acOfertarCita`) via a new
`CaptchaBlockedSlotsOffered` outcome, and `fillApplicantForm` was made trámite-aware instead of
assuming a fixed field set — see `docs/NODE_WORKER_ROADMAP.md` Phase 6. `check_completed`/
`captcha_required` are still not what gets published for this outcome, deliberately: it still maps
to a retryable `CheckFailedEvent` — that was true through Phase 6, but Phase 7 (node-worker side,
same week) changes it: `availability-checker.ts` no longer auto-releases the session for that
outcome, `CaptchaSessionRegistry.register()` now has a real caller for the first time, and
`messaging/command-handler.ts` actually pauses — generating a session token, publishing
`CaptchaRequiredEvent{sessionToken}` promptly, and waiting for either a human's `"resolved"` signal
(relayed via `index.ts`) or a configurable timeout before releasing. A real, previously-inert
`cita-watcher-docker/nginx/default.conf` bug (a `proxy_pass` trailing slash silently breaking the
`/captcha-ws/<token>` path) was found and fixed along the way. See `docs/NODE_WORKER_ROADMAP.md`
Phase 7 for the full write-up. **Deliberately deferred, confirmed with the user beforehand:** the
Laravel-side half of this same contract change — reading `sessionToken`, building the actual
`/captcha-ws/<token>` link, and a notification listener to tell a human about it — was deliberately
deferred to a separate branch/PR at the time, since the node-worker-side change shipped safely
alone with nothing on the Laravel side reading the new field yet. **That deferred piece is now
done** (`docs/APPLICATION_ROADMAP.md` Phase 10, same week): `WorkerEventRouter::routeCaptchaRequired()`
reads `sessionToken`, a new `CaptchaSessionUrlBuilderInterface`/`LaravelCaptchaSessionUrlBuilder`
builds the real link, and a new `NotifyOnCaptchaInterventionRequiredListener` sends it to the human
through the `WatchTask`'s configured channel. Steps 4-5 of the wizard (`acVerificarCita`/
`acGrabarCita`) remain unmodeled — deliberately: the CDP relay turned out to give a connected human
full, unscoped remote-control of the whole page (not just a captcha field), so once a human can
actually reach the relay they'd click through those two steps themselves, not node-worker. What
node-worker gained instead (`docs/NODE_WORKER_ROADMAP.md` Phase 8, same week): `command-handler.ts`
now reacts to a human's `"resolved"` signal by classifying the page they left it on
(`site-navigator.ts`'s new `classifyPostResolutionOutcome`) and publishing an honest
`CheckFailedEvent` about it — the one confirmed failure mode (the site's 5-minute window expiring)
gets its own reason string; anything else, including a real success (never observed live), still
falls through to the existing conservative `post_submit_unconfirmed` handling.

The link a human was told pointed straight at `/captcha-ws/<token>` — the raw WebSocket endpoint
itself, which does nothing when opened in a browser — until `docs/APPLICATION_ROADMAP.md` Phase 11
(same week) closed that gap: `application/public/captcha.html`, a static HTML/JS page with no
build step, served directly by nginx (not a Laravel route/view — nginx already used
`application/public/` as its content root), actually connects to the relay, renders the live
screencast on a canvas, and relays mouse/keyboard input plus a `"resolved"` signal back.
`LaravelCaptchaSessionUrlBuilder` now points there instead. Verified against a throwaway mock relay
(Playwright-driven, see that phase's write-up) and against the real `docker-compose` stack's 4400/
4404 close-code paths — **not** against a real captcha, which would mean attempting a real
reservation. That live walkthrough is the one thing still open: the page a human needs now exists,
but nobody has actually solved a real captcha through it end-to-end yet — and, per
`docs/NODE_WORKER_ROADMAP.md` Phase 9 (2026-08-08, real live testing against the actual site,
outside this walkthrough), it's now confirmed why the automated side alone can't get there yet
either: the target site's own bot defense reacts to Playwright headless Chromium specifically
(**not**, as previously and wrongly recorded in `docs/PHASE9_DRY_RUN.md`, a network-level firewall —
see that phase for the correction). `docs/NODE_WORKER_ROADMAP.md` Phase 10 (same day, direct
follow-up) shipped the fix into `node-worker/src/automation/session-manager.ts`'s real browser
launcher (headed under Xvfb, UA/`navigator.webdriver` overrides) and confirmed the real service
starts up correctly with it (catching and fixing a real PID-1/Xvfb-signal startup hang along the
way) — but deliberately did **not** spend another live attempt against the real site confirming this
actually gets a real run past the point Phase 9's attempts stalled at. `docs/NODE_WORKER_ROADMAP.md`
Phase 11 / `docs/APPLICATION_ROADMAP.md` Phase 12 (both done, same increment) then closed the `sede`
gap Phase 10 left open: `Procedure` gained an optional `sede` field on both sides (node-worker's
`types/commands.ts` plus the Laravel `Domain`/`Infrastructure`/`Presentation` layers and a matching
`watch_tasks` migration column), so a `WatchTask` created through the real API can now specify an
office — still unconfirmed live, pure wire-contract plumbing verified by tests only. Check the
relevant roadmap (`docs/APPLICATION_ROADMAP.md`, `docs/NODE_WORKER_ROADMAP.md`) before assuming a
later phase's piece exists.

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