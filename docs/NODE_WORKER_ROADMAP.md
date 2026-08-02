# node-worker Roadmap

Status: planning. `../node-worker/src/index.ts` is currently empty; `../node-worker/src/config.ts` is the only
implemented module. This document sequences the work needed to reach a complete,
production-ready worker as described in the root `../CLAUDE.md`.

Three module boundaries are assumed throughout, per `../CLAUDE.md`'s "Node worker" section:

- **`automation/`** — Playwright browser/session lifecycle and the actual site-check flow.
- **`captcha/`** — CDP screencast relay over WebSocket, session-token binding.
- **`messaging/`** — Redis command consumption (inbound from Laravel) and event
  publishing (outbound to Laravel).

Each depends on the others only through interfaces/types it owns — no reaching across
folders for concrete classes.

## Phase 0 — Shared foundations

- [ ] Add an ESLint config (`../node-worker/package.json` already wires `npm run lint`, but no config
      is committed yet — CLAUDE.md flags this explicitly).
- [ ] Set up `vitest` config/test scaffolding (`npm test` is wired but no tests exist).
- [ ] Define shared domain types in a neutral location (e.g. `src/types.ts` or per-module
      `types.ts` files): `WorkerCommand`, `CheckResult`, `AppointmentSlot`, and the three
      outbound event shapes (`CheckCompletedEvent`, `CaptchaRequiredEvent`,
      `CheckFailedEvent`) — these are the interfaces `automation`, `captcha`, and
      `messaging` will depend on instead of each other's concrete classes.
- [ ] Decide session-identity shape: what a "session token" looks like, since it's
      embedded directly in the `/captcha-ws/` path and used to bind a WS connection to a
      CDP/Chromium session (nginx does no auth — the worker is the only validator).

## Phase 1 — Automation core (`automation/`)

- [ ] Browser/session manager: launch Playwright Chromium, enforce
      `config.maxConcurrentSessions`, expose a session's CDP endpoint for Phase 3.
- [ ] Navigation + check flow against `sede.administracionespublicas.gob.es`: reach the
      appointment page, submit the trámite/province selection, read slot availability.
- [ ] Captcha detection (not solving): recognize when the flow has hit a captcha and
      surface that as a state, without yet wiring it anywhere.
- [ ] Session cleanup/teardown on success, failure, and crash (no leaked Chromium
      processes).
- [ ] Unit tests with a fake/mocked Playwright layer.

## Phase 2 — Captcha relay (`captcha/`)

- [ ] WebSocket server on `config.cdpRelay.port`, path-based session token parsing and
      validation.
- [ ] Bind an incoming WS connection to the matching automation session's CDP target;
      reject/close connections with an invalid or unknown token.
- [ ] Relay the CDP screencast frames (`Page.startScreencast` or equivalent) to the
      connected client.
- [ ] Relay human input back (clicks/keystrokes) to the Chromium session so a person can
      actually solve the captcha, then signal automation to resume.
- [ ] Tests: token validation edge cases, connection lifecycle (open/close/error).

## Phase 3 — Messaging (`messaging/`)

- [ ] Redis command consumer: `BRPOP`/`BLPOP` the raw `watcher-commands` Redis **list** (a plain
      RPUSH target, not a Laravel queue — see `../application/app/Infrastructure/Watcher/Messaging/RedisWorkerGateway.php`'s
      docblock for why this doesn't collide with `queue-worker`'s own Laravel-format job queue of
      the same logical name), deserialize into `WorkerCommand`, trigger an automation run. Current
      `WorkerCommand` shape (provisional — the Laravel side, not this one, defined it first; treat
      as a starting point to confirm, not a spec):
      ```json
      {
        "commandId": "uuid",
        "type": "check_availability",
        "watchTaskId": 42,
        "procedure": { "province": "...", "tramiteCode": "..." },
        "applicant": { "fullName": "...", "documentId": "...", "email": "...", "phone": "..." }
      }
      ```
      `commandId` (added in `../application`'s Phase 8) is for log correlation only — Laravel
      doesn't track or verify it, so there's no requirement to echo it back precisely, but doing so
      makes cross-service log correlation (this phase's own "correlate logs by session/command id"
      item below) actually possible.
- [ ] Redis event publisher: emit `CheckCompleted` / `CaptchaRequired` / `CheckFailed` as a single
      `watcher-events` pub/sub channel with a `type` discriminator (symmetric with the outbound
      shape above), which is what `../application`'s `WorkerEventRouter` already expects. Current
      expected shapes (same "provisional, confirm don't assume" caveat):
      ```json
      {"type": "check_completed", "watchTaskId": 42, "slots": [{"dateTime": "...", "office": "..."}], "checkedAt": "..."}
      {"type": "captcha_required", "watchTaskId": 42, "occurredAt": "..."}
      {"type": "check_failed", "watchTaskId": 42, "reason": "...", "retryable": true, "occurredAt": "..."}
      ```
      `check_failed`'s `retryable` (added in `../application`'s Phase 8) is this side's call to
      make: `true` for transient failures worth another scheduled attempt (network timeouts, the
      site being briefly unreachable), `false` for failures that will never succeed on retry (e.g.
      an invalid procedure/trámite combination). Laravel trusts this flag as-is — it does no
      independent judgment of `reason` strings.
- [ ] Backpressure/concurrency: don't pull more commands than
      `maxConcurrentSessions` allows in flight.
- [ ] Tests against a real or in-memory Redis (ioredis is already a dependency).

## Phase 4 — Wiring (`../node-worker/src/index.ts`)

- [ ] Bootstrap sequence: load `config`, construct automation/captcha/messaging
      instances wired through their interfaces, start the command consumer and the WS
      relay server.
- [ ] Graceful shutdown: on SIGTERM/SIGINT, stop accepting new commands, close browser
      sessions, close WS connections, disconnect Redis.
- [ ] Top-level error handling so one failed session doesn't crash the process.

## Phase 5 — Hardening & observability

- [ ] Structured logging (correlate logs by session/command id).
- [ ] Retry/backoff policy for transient site failures vs. hard failures
      (`CheckFailedEvent` semantics).
- [ ] Health signal for the container (used by compose/orchestration).
- [ ] Confirm behavior under `shm_size: 1gb` constraint (docker-compose already sets
      this for headless Chromium).

## Phase 6 — Integration verification

- [ ] End-to-end dry run through `docker compose -f cita-watcher-docker/docker-compose.yml
      up -d`: Laravel enqueues a command → node-worker processes it → event lands back
      on Redis.
- [ ] Manual captcha-solving walkthrough through the `/captcha-ws/` relay via nginx.

## Explicit non-goals for this roadmap

- The Laravel-side `event-consumer` service/artisan command — tracked separately in the
  `../application` side, only consumed here as an interface contract (event shapes).
- Anything about `../application` internals beyond the message contract.
