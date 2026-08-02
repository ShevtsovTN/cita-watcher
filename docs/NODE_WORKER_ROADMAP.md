# node-worker Roadmap

Status: Phase 0 done. `../node-worker/src/index.ts` is still an empty stub;
`../node-worker/src/config.ts`, `types.ts`, and `session-token.ts` are the only implemented
modules — `automation/`, `captcha/`, and `messaging/` themselves don't exist as directories yet
(Phases 1–3). This document sequences the work needed to reach a complete, production-ready worker
as described in the root `../CLAUDE.md`.

Three module boundaries are assumed throughout, per `../CLAUDE.md`'s "Node worker" section:

- **`automation/`** — Playwright browser/session lifecycle and the actual site-check flow.
- **`captcha/`** — CDP screencast relay over WebSocket, session-token binding.
- **`messaging/`** — Redis command consumption (inbound from Laravel) and event
  publishing (outbound to Laravel).

Each depends on the others only through interfaces/types it owns — no reaching across
folders for concrete classes.

## Phase 0 — Shared foundations ✅ done

- [x] Add an ESLint config (`../node-worker/package.json` already wires `npm run lint`, but no config
      is committed yet — CLAUDE.md flags this explicitly). Added `eslint.config.mjs` (flat config,
      required by ESLint 9) using `typescript-eslint`'s `strictTypeChecked` preset — matches the
      strictness already baked into `tsconfig.json`. `.mjs` (not `.js`) because `package.json` has
      no `"type": "module"`; a plain `.js` config using `import`/`export` would be parsed as
      CommonJS and fail. Neither `typescript-eslint` nor `globals` (needed for the Node global
      env) were installed at all — added both as devDependencies.
- [x] Set up `vitest` config/test scaffolding (`npm test` is wired but no tests exist). Added
      `vitest.config.ts` (`environment: "node"`, `include: ["src/**/*.test.ts"]`, `globals: false`
      — explicit `import { describe, it, expect } from "vitest"`, matching the codebase's
      no-implicit-magic style) plus the first real tests: `config.test.ts` (the one existing
      module, `loadConfig`, had zero coverage before this) and `session-token.test.ts`. Test files
      are colocated next to their subject in `src/` (`config.test.ts` beside `config.ts`), not a
      separate `tests/` tree — `tsconfig.json`'s pre-existing `"exclude": [..., "**/*.test.ts"]`
      already implied this layout.
- [x] Define shared domain types in a neutral location (e.g. `src/types.ts` or per-module
      `types.ts` files): `WorkerCommand`, `CheckResult`, `AppointmentSlot`, and the three
      outbound event shapes (`CheckCompletedEvent`, `CaptchaRequiredEvent`,
      `CheckFailedEvent`) — these are the interfaces `automation`, `captcha`, and
      `messaging` will depend on instead of each other's concrete classes. Added as a `src/types/`
      directory (not per-module files yet — `automation/`/`captcha/`/`messaging/` don't exist as
      directories yet, so there's nothing to scope per-module types to today; revisit once Phase 1+
      actually creates those folders and wants their own narrower types), split by concern —
      `commands.ts` (`Procedure`, `ApplicantData`, `WorkerCommand`), `check-result.ts`
      (`AppointmentSlot`, `CheckResult`), `events.ts` (`CheckCompletedEvent`,
      `CaptchaRequiredEvent`, `CheckFailedEvent`, `WorkerEvent`) — with `index.ts` re-exporting all
      three so the rest of the codebase imports from `./types`, never from the individual files
      inside it. Shapes mirror exactly what's documented in this file's own Phase 3 section,
      including Phase 8's `commandId`/`retryable` additions from the Laravel side.
- [x] Decide session-identity shape: what a "session token" looks like, since it's
      embedded directly in the `/captcha-ws/` path and used to bind a WS connection to a
      CDP/Chromium session (nginx does no auth — the worker is the only validator). Added
      `src/session-token.ts`: `SessionToken` (opaque string) + `generateSessionToken()` via
      `crypto.randomBytes(32).toString("base64url")` — 256 bits of raw entropy, URL-safe, no
      padding. Chosen over `crypto.randomUUID()` specifically because this token is a bearer-style
      secret embedded in a URL with zero other authentication (see the module's own docblock) —
      UUIDs carry less entropy (~122 bits) and a recognizable structure, which matters more here
      than for an ordinary identifier.

**Changes not in the original checklist / open follow-up:**
- **`CaptchaRequiredEvent` doesn't carry the session token or a `/captcha-ws/` URL yet** — Laravel
  currently has no way to hand a human a link to actually solve the captcha once one is needed.
  Deliberately not resolved in this phase (`session-token.ts`'s docblock flags it): the token's
  *shape* is Phase 0's job; deciding when it gets generated, how it's bound to a session, and
  whether it needs to travel in the outbound event is Phase 2 (`captcha/`, once a token is actually
  bound to something) or Phase 3 (`messaging/`, if it needs to ride in `CaptchaRequiredEvent`) — and
  the latter would also need a matching change to `../application`'s
  `CaptchaInterventionRequiredEvent`/`HandleCaptchaRequiredUseCase`, which don't have a field for it
  either. Don't let this stay silently forgotten once Phase 2/3 start.
- **Pre-existing, unrelated `npm audit` findings**: 7 vulnerabilities (1 critical: `vitest`; 2 high:
  `ws`, `brace-expansion`; 2 moderate: `esbuild` via `tsx`; 2 low: `eslint`'s own
  `@eslint/plugin-kit`) — all in already-pinned dependencies (`eslint`, `tsx`, `vitest`, `ws`), none
  introduced by this phase's `typescript-eslint`/`globals` additions. Fixing means bumping pinned
  versions beyond `package.json`'s stated ranges (`npm audit fix --force`) — a separate decision,
  not made here.
- **`node-worker/.gitignore` was a near-verbatim copy of the Laravel app's** (`/vendor`,
  `_ide_helper.php`, `.phpunit.cache`, etc. — nothing Node/TS-specific, and no `dist/` entry at
  all). Replaced with a proper Node/TS `.gitignore` (`/dist`, `*.tsbuildinfo`, `/coverage`, etc.).
- **Dev container permission gaps found while verifying `npm install`/`npm run build`** (not fixed,
  just worked around for this session): the `node-worker` compose service has no `user:` override
  (unlike `app`/`queue-worker`/etc., which run as `${DOCKER_UID}:${DOCKER_GID}`), so
  bind-mounted-file writes (`npm install` touching `package.json`, `tsc` writing `dist/`) fail as
  the image's fixed `pwuser`. Worked around per-command via a one-off `docker compose exec -u root`,
  chowning back to the host UID afterward for bind-mounted files. Not fixed at the compose level
  here — unlike the PHP services, changing node-worker's runtime user risks breaking
  Playwright's `pwuser`-relative paths (browser binaries, `$HOME`), which needs real verification,
  not a speculative change made in passing.

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
