# node-worker Roadmap

Status: Phase 0 through Phase 5 done; Phase 6 partially done. `automation/` has `PlaywrightSessionManager`
(browser/session lifecycle + concurrency guard + CDP access), a real-site navigator
(`site-navigator.ts` + `province-routes.ts`/`country-codes.ts`/`document-id-validator.ts`) confirmed
against `icp.administracionelectronica.gob.es` via live reconnaissance, and session-teardown
wrapping (`availability-checker.ts`). True captcha-widget detection is accepted as closed for
Phase 1 without ever being confirmed: live recon never got past a sticky WAF block on the
applicant-form submit, so no real captcha was ever observed (see Phase 1 below) — still true after
Phase 2, since `captcha/` never got exercised against the real site either (see Phase 2's own notes
below). `captcha/` now has the full relay pipeline built and unit-tested against fakes:
`relay-server.ts` (`WsScreencastRelay`, WS server on `config.cdpRelay.port`, path-based token
parsing/validation), `session-registry.ts`/`session-binder.ts` (`CaptchaSessionRegistry` mapping a
token to its `AutomationSession`, closing unknown-token connections separately from
malformed-token ones), `screencast-frame-relay.ts` (`CdpScreencastFrameRelay`, pipes
`Page.startScreencast` frames to the WS client), and `input-relay.ts` (`CdpInputRelay`, relays
mouse/key input back via `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent`, plus a `resolved`
signal to tell automation to resume). None of it has been exercised against a live `/captcha-ws/`
connection or a real captcha widget yet — see Phase 2 below.
`messaging/` now exists and is fully tested: `redis-command-consumer.ts` (`RedisCommandConsumer`, a
`BRPOP` loop over the `watcher-commands` list with its own backpressure guard),
`worker-command-parser.ts` (`parseWorkerCommand`), `redis-event-publisher.ts`
(`RedisEventPublisher`, publishes to `watcher-events`), `outcome-to-event.ts`
(`mapNavigationOutcomeToCheckFailedEvent` — every `NavigationOutcome` still maps to
`CheckFailedEvent`, since no real captcha or success page has ever been confirmed), and
`command-handler.ts` (`createWorkerCommandHandler`, wiring the above through `automation/`'s
`checkAvailability`) — see Phase 3 below. Closed a Phase 1 gap along the way: `ApplicantData` now
carries `documentType`/`birthYear`/`nationality` on both sides (`../application`'s
`ApplicantData.php`/`DocumentTypeEnum` in lockstep with `types/commands.ts`), so
`site-navigator.ts`'s own `DocumentIdentity` type is gone.
`../node-worker/src/index.ts` is no longer a stub: it's the composition root wiring
`automation/`/`captcha/`/`messaging/` into an actual running process — a `PlaywrightSessionManager`,
two dedicated `ioredis` clients (`RedisCommandConsumer`'s blocking `BRPOP` can't share a connection
with `RedisEventPublisher`'s `PUBLISH`), and a `WsScreencastRelay` bound through
`bindConnectionToRegisteredSession` to a new `relayCaptchaSession()` helper — plus graceful
SIGTERM/SIGINT shutdown and top-level error handling so one failed command/connection can't take
the process down. Verified manually against the real dev stack (BRPOP connection live in
`redis-cli CLIENT LIST`, invalid-token WS connections closed with code `4400`), not just against
fakes. `CaptchaSessionRegistry.register()` still has no caller, though — no real captcha has ever
been observed, so `onBound` is wired and ready but never actually fires yet; see Phase 4 below.
Phase 5 closed out the remaining hardening items: `src/logger.ts` (a `Logger` with
`command_id`/`watch_task_id`-correlated `withContext()`, matching Laravel's own `Log::withContext`
field names so both services' logs are grep-able by the same keys) replaced the ad-hoc
`console.log`/`console.error` calls Phase 4 added; `command-handler.ts` now catches an uncaught
exception from `checkAvailability` itself and publishes a `retryable: true` `CheckFailedEvent`
instead of silently dropping the command (closing the gap Phase 4's write-up flagged); a new
`src/health-server.ts` (`HttpHealthServer` on `config.health.port`/`HEALTH_PORT`, default `4002`)
backs a `healthcheck:` block on the `node-worker` compose service; and `shm_size: 1gb` was
confirmed sufficient for 3 concurrent real Chromium sessions doing rendering-heavy work, not just
assumed. See Phase 5 below for the full write-up. Phase 6's first item (a real end-to-end dry run,
not a `redis-cli`-simulated one) is done — see `../docs/PHASE9_DRY_RUN.md`'s "Re-run with the real
node-worker" section, which also caught and fixed a real, unrelated pre-existing bug
(`event-consumer` crash-looping on a Redis `read_timeout` default). Phase 6's second item (the
manual captcha-solving walkthrough) remains genuinely blocked, same reason as always:
`CaptchaSessionRegistry.register()` has no caller and the screencast UI is undesigned.
This document sequences the work needed to reach a complete, production-ready worker as described
in the root `../CLAUDE.md`.

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

## Phase 1 — Automation core (`automation/`) ✅ done

- [x] Browser/session manager: launch Playwright Chromium, enforce
      `config.maxConcurrentSessions`, expose a session's CDP endpoint for Phase 3. Added
      `src/automation/session-manager.ts`: `SessionManager` (role interface) /
      `PlaywrightSessionManager` (concrete impl, following the repo's role-interface naming
      convention), `AutomationSession` (id + `Page` + `newCdpSession()` — the CDP access
      `captcha/`, Phase 2, will actually consume; the roadmap text above said "Phase 3" but the
      only real CDP consumer is the captcha relay, Phase 2), `SessionLimitExceededError`. The
      browser itself is launched lazily on first `acquire()` and reused across sessions (one
      `Browser`, many `BrowserContext`s — cheaper and closer to how a long-lived worker process
      should behave than relaunching Chromium per check). The concurrency guard reserves a session
      id *synchronously*, before any `await`, specifically so concurrent `acquire()` calls can't
      both pass a `size >= max` check before either has actually registered — a real race with a
      naive "check size, then create context" ordering once `messaging/` (Phase 3) starts calling
      this from multiple in-flight commands. A `browser.on("disconnected", ...)` handler clears all
      tracked sessions if Chromium itself crashes, so a crashed browser doesn't leave the manager
      reporting phantom active sessions forever.
- [x] Navigation + check flow: confirmed via live reconnaissance (Claude in Chrome against the real
      site) that the actual booking system lives at `icp.administracionelectronica.gob.es` —
      `sede.administracionespublicas.gob.es` is only the entry point that links out to it. Added
      `src/automation/site-navigator.ts` (`runAvailabilityCheck`, free functions over an injected
      `Page`, not a class — there's no cross-call state to hold), `src/automation/province-routes.ts`
      (full ~52-province → `{basePath, id}` table; each province has its own base path —
      `icpplus`/`icpco`/`icpplustie`/`icpplustieb`/`icpplustiem` — not a single fixed route),
      `src/automation/country-codes.ts` (full ~190-country → numeric-code table for the "País de
      nacionalidad" select), and `src/automation/document-id-validator.ts` (`isValidDocumentId`,
      replicates the site's own client-side NIE/DNI mod-23 checksum so a document id already known
      to be invalid never reaches the network). Confirmed flow: province select → one of two
      trámite `<select>`s (matched by visible label, since the set of available trámites differs
      per province) → either a same-page "Presentación con Cl@ve" panel (some trámites, e.g.
      residence-permit renewals, are Cl@ve-only — `RequiresClave`, never click into it) or real
      navigation to `/icpplus/acInfo` → "Entrar" → the applicant form `/icpplus/acEntrada` (radios
      N.I.E./D.N.I./PASAPORTE, name, birth year, nationality) → submit. What a *clean*
      (non-WAF-blocked) submit actually returns — captcha, "no slots", or a real slot listing — is
      still unconfirmed; see `PostSubmitUnconfirmed` and the captcha-detection item below.
- [x] Captcha detection (not solving): closed for this phase without ever observing a real captcha
      — live reconnaissance never got past a WAF (see "Changes not in the original checklist" below)
      that rejected the session right at the applicant-form submit, before any captcha widget was
      ever shown. What *was* confirmed and is now detected as part of the navigation work above:
      `RequiresClave` (a Cl@ve-gated trámite — not a captcha at all), `WafRejected` (the WAF block
      itself), and `ValidationRejected` (the site's own "Es incorrecto" inline validation).
      `PostSubmitUnconfirmed` is the explicit marker for "a real captcha still needs to be
      observed" — carried forward into Phase 2 rather than replaced with guessed selectors here;
      Phase 2's WS relay is what gives a real shot at getting past the WAF to actually see one.
- [x] Session cleanup/teardown on success, failure, and crash (no leaked Chromium processes). Added
      `src/automation/availability-checker.ts`'s `checkAvailability`: acquires a session, runs the
      check (defaults to `runAvailabilityCheck`, injectable as `runCheck` for tests — same seam as
      `PlaywrightSessionManager`'s `launchBrowser`), and releases it in a `finally`, so release
      happens whether the check resolves an outcome or throws (unknown province/trámite/
      nationality, or a genuine Playwright error). Complements `PlaywrightSessionManager.release()`/
      `closeAll()`/the `disconnected` handler above, which cover session-manager-level cleanup.
- [x] Unit tests with a fake/mocked Playwright layer — `src/automation/session-manager.test.ts` (10
      cases, as before) plus, for this increment's additions: `site-navigator.test.ts` (10 cases —
      one per `NavigationOutcome` branch/thrown error, using the same hand-built-fake idiom against
      `Page`/`Locator` instead of `Browser`/`BrowserContext`), `availability-checker.test.ts` (5
      cases covering the try/finally release semantics against a fake `SessionManager` and an
      injected `runCheck`), and pure-data tests for `province-routes.ts`/`country-codes.ts`/
      `document-id-validator.ts` (no Playwright fakes needed — hand-verified mod-23 checksum
      vectors for the latter). 56 tests total across the package.

**Verification for this increment:** `npm run typecheck`, `npm run lint`, and `npm test` all pass
(run via a throwaway `node:22-slim` container with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, since the
dev container wasn't available in this session — see node-worker/CLAUDE.md's "Known dev-container
gap" for the normal way to run these). Fixed two pre-existing gaps this surfaced along the way,
unrelated to session-manager logic itself: `eslint.config.mjs`'s `allowDefaultProject` only matched
`src/*.test.ts` (one level deep), so nested test files like this phase's own
`src/automation/session-manager.test.ts` failed to parse — broadened to also match
`src/*/*.test.ts`; and `@typescript-eslint/unbound-method` flags vitest's own
`expect(fake.method).toHaveBeenCalled()` idiom as if it were the real unbound-`this` bug it exists
to catch, so it's now turned off specifically for `**/*.test.ts` — both will affect any future test
file, not just this one.

**Changes not in the original checklist / open follow-up (navigation increment):**
- **Sticky WAF, discovered live, not a captcha.** Submitting the applicant form
  (`/icpplus/acEntrada` → `acValidarEntrada`) got the whole browser session rejected by what looks
  like an F5 BIG-IP ASM WAF (title "Request Rejected", body "The requested URL was rejected...
  Your support ID is: <...>"). After that, **previously-working URLs in the same session** started
  returning the same rejection — the block is session/IP-scoped and sticky, not a per-request rule.
  It also triggered once immediately on a first `citar` request for Madrid while Cuenca's worked
  fine seconds later — unpredictable across provinces from a single session. Modeled as
  `WafRejected` in `site-navigator.ts`; flagged here for `messaging/` (Phase 3) to eventually map
  onto `CheckFailedEvent{retryable: true}`, since a WAF cooldown is exactly the kind of transient
  failure worth a later scheduled retry.
- **`ApplicantData` (`src/types/commands.ts`) is missing fields the real form actually needs** —
  `documentType` (N.I.E./D.N.I./PASAPORTE — the wire type has no discriminator at all) plus
  `birthYear`/`nationality` (not present either). `site-navigator.ts` defines its own
  `DocumentIdentity` type for now rather than guessing at a wire-contract change; mapping
  `ApplicantData` → `DocumentIdentity` — and the matching Laravel-side `WorkerCommand.php` change —
  is left for Phase 3 once `messaging/` actually needs to bridge the two.
- **Deliberate scope trims**, given how much of the post-submit page remains unconfirmed: no office
  selection (the site's own "Cualquier oficina" default is exactly what a watcher wants); the
  Cl@ve panel is detected and returned on immediately, never clicked into (there's no payoff in
  navigating further into an external government identity login the worker can't complete anyway);
  no guessed "success" outcome — see `PostSubmitUnconfirmed` above.
- Both `PROVINCE_ROUTES` (~52 entries) and `COUNTRY_CODES` (~190 entries) were captured verbatim
  from the real `<select>` options during this session's recon and are populated in full, not left
  as partial/TODO tables.

## Phase 2 — Captcha relay (`captcha/`) ✅ done

- [x] WebSocket server on `config.cdpRelay.port`, path-based session token parsing and
      validation. Added `src/captcha/relay-server.ts`: `extractSessionToken()` (pure, parses
      `/captcha-ws/<token>` from `req.url`) and `WsScreencastRelay` (the `ScreencastRelay` role
      interface anticipated in `../node-worker/CLAUDE.md`'s naming table). Connections with a
      missing/malformed token are closed immediately with close code `4400`; well-formed ones are
      handed to an injected `onValidConnection` callback rather than assumed valid — see the next
      item. Also added `isSessionToken()` to `../node-worker/src/session-token.ts` (form validation
      lives with the module that owns the token's shape).
- [x] Bind an incoming WS connection to the matching automation session's CDP target;
      reject/close connections with an invalid or unknown token. Added
      `src/captcha/session-registry.ts` (`CaptchaSessionRegistry`/`InMemoryCaptchaSessionRegistry`,
      mapping `SessionToken` → `AutomationSession`) and `src/captcha/session-binder.ts`
      (`bindConnectionToRegisteredSession`, wraps `onValidConnection` to resolve the token and
      close unregistered-but-well-formed tokens with a distinct close code, `4404`, from the
      malformed-token `4400` above). Who calls `registry.register()` — i.e. when a token actually
      gets minted and tied to a session — is still open; see "Changes not in the original
      checklist" below.
- [x] Relay the CDP screencast frames (`Page.startScreencast` or equivalent) to the
      connected client. Added `src/captcha/screencast-frame-relay.ts`: `CdpScreencastFrameRelay`
      starts the screencast on a bound `CDPSession`, forwards each frame to the WS client as
      `{type: "screencast_frame", data}` (base64 as CDP sends it, no re-encoding), and acks every
      frame by `sessionId` without letting an ack failure (e.g. CDP session already gone) take the
      relay down with it.
- [x] Relay human input back (clicks/keystrokes) to the Chromium session so a person can
      actually solve the captcha, then signal automation to resume. Added
      `src/captcha/input-relay.ts`: `CdpInputRelay` parses inbound WS JSON messages
      (`RemoteMouseInput`/`RemoteKeyInput`/`RemoteResolvedSignal` — this module's own wire
      contract, see "Changes not in the original checklist" below) into
      `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent` CDP calls, and invokes an injected
      `onResolved()` callback on a `{"type": "resolved"}` message — "signal automation to resume"
      itself, i.e. what actually un-blocks the paused check, is Phase 4's job once there's an
      `index.ts` to wire it to. Parsing never throws: unrecognized/malformed input is silently
      dropped, since it originates from a human's browser with no schema enforced upstream.
- [x] Tests: token validation edge cases, connection lifecycle (open/close/error). 112 tests total
      across the package (up from Phase 1's 76) — all against hand-built fakes of `ws`'s
      `WebSocketServer`/`WebSocket` and Playwright's `CDPSession`, same idiom as Phase 1's
      Playwright fakes.

**Verification for this increment:** `npm run typecheck`, `npm run lint`, and `npm test` all pass,
run inside the already-running `node-worker` dev container
(`docker compose -f ../cita-watcher-docker/docker-compose.yml exec node-worker <cmd>`). Raised
eslint's `allowDefaultProject` file-count cap (`maximumDefaultProjectFileMatchCount_...`, default
8) to 32 — Phase 2's own test files crossed the default cap on top of Phase 0/1's.

**Changes not in the original checklist / open follow-up:**
- **Nothing in `captcha/` has been exercised against the real site or a real browser yet** — every
  test here runs against hand-built fakes, the same limitation Phase 1's navigation work had before
  its own live-recon pass. `WsScreencastRelay` has never accepted a real WS connection through
  nginx's `/captcha-ws/` proxy, `CdpScreencastFrameRelay` has never seen a real
  `Page.screencastFrame` event, and — most importantly — **no real captcha widget has ever been
  observed**, so `PostSubmitUnconfirmed` (`../node-worker/src/automation/site-navigator.ts`, Phase
  1) is still exactly as unconfirmed as it was before this phase. The hope stated in Phase 1's
  status line — that a persistent CDP-relayed session might get further than recon's one-shot
  WAF-blocked attempts — is untested, not confirmed.
- **The screencast-frame and remote-input wire contracts (`ScreencastFrameMessage`,
  `RemoteMouseInput`/`RemoteKeyInput`/`RemoteResolvedSignal` in `screencast-frame-relay.ts`/
  `input-relay.ts`) are this phase's own invention, not a spec from anywhere** — there is no UI
  client yet (root `../CLAUDE.md` calls it "undesigned"), so these shapes were kept deliberately
  minimal (just enough to actually move a mouse/press a key/render a frame) rather than guessing at
  what a real captcha-solving UI will eventually need (e.g. frame `metadata` for coordinate
  mapping is deliberately not forwarded to the client). Whoever builds that UI next should treat
  this contract as a starting point to renegotiate, not a fixed spec — same spirit as `messaging/`'s
  own "provisional, confirm don't assume" `WorkerCommand`/`WorkerEvent` shapes in Phase 3 below.
- **`CaptchaSessionRegistry.register()` has no caller anywhere in the codebase yet.** Nothing
  currently decides *when* a session needs human help and mints/binds a token for it — that
  requires real captcha detection (still blocked, see above) or some other trigger. This is the
  same open question flagged since Phase 0 (`../node-worker/src/session-token.ts`'s docblock:
  `CaptchaRequiredEvent` still doesn't carry a token or `/captcha-ws/` URL either) — still not
  resolved, now with one more piece (`register()`) waiting on the same answer.

## Phase 3 — Messaging (`messaging/`) ✅ done

- [x] Redis command consumer: `BRPOP`s the raw `watcher-commands` Redis **list** (a plain RPUSH
      target, not a Laravel queue — see `../application/app/Infrastructure/Watcher/Messaging/RedisWorkerGateway.php`'s
      docblock for why this doesn't collide with `queue-worker`'s own Laravel-format job queue of
      the same logical name), deserializes into `WorkerCommand`, triggers an automation run. Added
      `src/messaging/redis-command-consumer.ts` (`RedisCommandConsumer`, a `BRPOP`-loop with a
      1-second timeout — short on purpose, see its own docblock: an in-flight blocking `BRPOP`
      can't be cancelled, so `stop()`'s worst case is bounded by this constant) and
      `src/messaging/worker-command-parser.ts` (`parseWorkerCommand`, never throws — malformed
      Redis payloads are dropped, same idiom as `../captcha/input-relay.ts`'s
      `parseRemoteInputMessage`). "Trigger an automation run" itself is
      `src/messaging/command-handler.ts`'s `createWorkerCommandHandler` — see below, it needed the
      `ApplicantData` contract change first. Confirmed (not provisional anymore) `WorkerCommand`
      shape, now matching `../application`'s actual `WorkerCommand.php`/`ApplicantData.php`:
      ```json
      {
        "commandId": "uuid",
        "type": "check_availability",
        "watchTaskId": 42,
        "procedure": { "province": "...", "tramiteCode": "..." },
        "applicant": {
          "fullName": "...", "documentType": "dni|nie|pasaporte", "documentId": "...",
          "email": "...", "phone": "...", "birthYear": 1990, "nationality": "..."
        }
      }
      ```
- [x] Redis event publisher: emits `CheckCompleted` / `CaptchaRequired` / `CheckFailed` on the
      single `watcher-events` pub/sub channel with a `type` discriminator, which is what
      `../application`'s `WorkerEventRouter` already expects. Added
      `src/messaging/redis-event-publisher.ts` (`EventPublisher`/`RedisEventPublisher`). Event
      shapes are unchanged from what was already documented here and match `../application`
      exactly — no surprises on this side.
- [x] Backpressure/concurrency: `RedisCommandConsumer` tracks its own in-flight count and stops
      pulling once it hits the constructor's `maxConcurrent`, polling (short injectable `sleep`)
      instead of relying on `SessionManager`'s own `SessionLimitExceededError` to catch an
      over-pull after the fact.
- [x] Tests against a real or in-memory Redis (ioredis is already a dependency). Added
      `src/messaging/redis-integration.test.ts` — the one test file in the package that opens a
      real TCP connection (to the `redis` service, logical DB 15 so it never touches whatever
      Laravel's own DB-0 usage has in it), publish→subscribe and RPUSH→BRPOP round trips. Everything
      else in `messaging/` (and the rest of the package) still uses hand-built fakes.

**Verification for this increment:** `npm run typecheck`, `npm run lint`, and `npm test` all pass
inside the running `node-worker` dev container. 147 tests in `node-worker/` (up from Phase 2's
112) plus, on the Laravel side, all 146 `application/` tests plus `./vendor/bin/pint --test` clean
after the `ApplicantData` contract change below.

**Changes not in the original checklist / open follow-up:**
- **`ApplicantData` contract extended on both sides, closing a Phase 1 gap.** The real applicant
  form (`../node-worker/src/automation/site-navigator.ts`) needs `documentType`/`birthYear`/
  `nationality`, which neither side's `ApplicantData` had (`site-navigator.ts` was carrying its own
  parallel `DocumentIdentity` type instead of guessing at the wire contract — see its Phase 1
  notes). Both sides gained the three fields in lockstep: `../node-worker/src/types/commands.ts`
  (plus a new shared `DocumentType`, moved out of
  `../node-worker/src/automation/document-id-validator.ts` since it's now a wire-contract concern,
  not an `automation/`-only one) and `../application/app/Domain/Watcher/ValueObjects/ApplicantData.php`
  (plus a new `DocumentTypeEnum`, `birthYear` range-validated `[1900, current year]`, `nationality`
  non-blank-validated) — touching `WorkerCommand.php`, `LaravelApplicantDataEncryptor.php`,
  `CreateWatchTaskRequest.php`, `WatchTaskController.php`, and ~25 test fixtures on the Laravel
  side. `WatchTaskResource.php` deliberately does **not** expose any of it in API responses, same
  policy as the pre-existing `documentId` omission (Phase 7). With the contract now identical in
  shape, `CheckAvailabilityRequest.applicant` in `site-navigator.ts` is `ApplicantData` directly —
  `DocumentIdentity` is gone, not just aliased.
- **`command.procedure.tramiteCode` is passed to `checkAvailability` as `tramiteLabel` verbatim,
  with no translation table.** `../application`'s `Procedure` value object validates `tramiteCode`
  only as a non-blank string — no enum, no per-province code→label table exists or is planned by
  this change. The operating assumption (deliberate, not an oversight — see
  `command-handler.ts`'s own docblock) is that whoever creates a `WatchTask` types the exact
  Spanish `<select>` option text into `tramiteCode`. A real per-province code table (the same scale
  of recon as `province-routes.ts`) is explicitly left for later if this assumption stops being
  good enough.
- **Every `NavigationOutcome` today maps to `CheckFailedEvent`, never `CheckCompleted`/
  `CaptchaRequired`.** Added `src/messaging/outcome-to-event.ts`
  (`mapNavigationOutcomeToCheckFailedEvent`) — `requires_clave`/`validation_rejected` →
  `retryable: false`, `waf_rejected` → `retryable: true` (as Phase 1's own notes already flagged),
  and `post_submit_unconfirmed` → `retryable: true` too, a deliberately conservative choice: since
  it's genuinely unknown whether that page was a captcha, "no slots", or a real listing, the event
  doesn't claim to know either — it just asks for another scheduled attempt. This is not a
  placeholder to "fix later automatically" — extending past `CheckFailedEvent` requires a new,
  *confirmed* `NavigationOutcome` variant in `site-navigator.ts` first (i.e. real captcha detection
  or a confirmed success page), which is still blocked exactly as Phase 1/2 described.
- **`CaptchaSessionRegistry.register()` (`../captcha/session-registry.ts`, Phase 2) still has no
  caller.** `command-handler.ts` never produces a `CaptchaRequiredEvent` (see above), so nothing in
  this increment needed to mint/bind a session token yet. Still the same open question carried
  since Phase 0.
- **`../node-worker/src/index.ts` is still an empty stub.** Nothing in this phase wires
  `RedisCommandConsumer`/`RedisEventPublisher`/`createWorkerCommandHandler`/`WsScreencastRelay`
  together into an actual running process yet — that's Phase 4.

## Phase 4 — Wiring (`../node-worker/src/index.ts`) ✅ done

- [x] Bootstrap sequence: load `config`, construct automation/captcha/messaging
      instances wired through their interfaces, start the command consumer and the WS
      relay server. `index.ts` is a `main()` composition root: one `PlaywrightSessionManager`
      (`config.maxConcurrentSessions`), two separate `ioredis` clients — `BRPOP` blocks its
      connection for up to a second at a time, so the command consumer needs one dedicated to
      itself rather than sharing with `RedisEventPublisher`'s `PUBLISH` calls — a
      `RedisCommandConsumer` wired to `createWorkerCommandHandler(sessionManager, eventPublisher)`,
      and a `WsScreencastRelay` wired through `bindConnectionToRegisteredSession` to a new
      `relayCaptchaSession()` helper (constructs `CdpScreencastFrameRelay`/`CdpInputRelay` per
      bound connection, resolves when the socket closes). Both `commandConsumer.start()` and
      `screencastRelay.start()` are called before `main()` returns.
- [x] Graceful shutdown: on SIGTERM/SIGINT, stop accepting new commands, close browser
      sessions, close WS connections, disconnect Redis. `shutdown()` runs the four steps in
      that literal order — `commandConsumer.stop()` first (bounded by its own 1s `BRPOP` timeout,
      see `redis-command-consumer.ts`), then closes every socket tracked in `onBound`'s
      `openSockets` set (the `ws` library's own `WebSocketServer.close()` does *not* close
      already-open client connections, only stops accepting new ones — has to be done explicitly),
      then `screencastRelay.stop()`/`sessionManager.closeAll()`, then `commandRedis.quit()`/
      `eventRedis.quit()` — safe only because the `BRPOP` client is guaranteed idle by that point.
      Guarded by a `shuttingDown` flag so a second signal during shutdown is a no-op rather than
      re-entering the sequence.
- [x] Top-level error handling so one failed session doesn't crash the process. Three layers:
      `withErrorHandling()` wraps the command handler itself (catches and logs, doesn't crash the
      `RedisCommandConsumer` loop — note `redis-command-consumer.ts`'s own `void
      this.onCommand(command).finally(...)` has no `.catch()`, so an unwrapped handler rejecting
      would otherwise become an unhandled rejection); `onBound`'s `relayCaptchaSession(...).catch()`
      does the same for captcha-relay connections; and process-level `unhandledRejection`/
      `uncaughtException` listeners are the last-resort net for anything neither of those catches.
      None of these publish a fallback `CheckFailedEvent` on an uncaught exception — just log —
      deciding whether that's worth doing, and real structured logging (this just uses
      `console.log`/`console.error`), are Phase 5's job, not resolved here.

**Verification for this increment:** `npm run typecheck`, `npm run lint`, and `npm test` all pass
(147 tests, unchanged from Phase 3 — this phase adds no new test file, see "Changes not in the
original checklist" below). Manually verified against the real `docker-compose` dev stack (not
just fakes): `redis-cli CLIENT LIST` shows the worker's dedicated `BRPOP`-blocked connection
live, and connecting a raw WS client to `ws://node-worker:4001/captcha-ws/<garbage>` gets closed
with code `4400`/`"invalid or missing session token"` as `relay-server.ts` specifies. `tsx watch`
restarting the process on every source edit during this session's own development also exercised
the SIGTERM path repeatedly (`command: ["npm", "run", "dev"]` in `docker-compose.yml`) — it always
shut down and reached `[node-worker] started: ...` again on the next boot, never hung.

**Changes not in the original checklist / open follow-up:**
- **No `index.test.ts`.** Unlike Phase 0-3, this phase's own checklist above never listed a "Tests"
  item — `main()` is a composition root wiring together already-unit-tested pieces via real
  `ioredis`/`ws`/Playwright constructors, which is exactly the kind of thing this codebase's own
  fake-based idiom doesn't have a clean seam for without inventing DI factories purely for a test
  that would just re-assert "these constructor calls happened." Correctness here is proven by the
  manual dev-stack verification above instead, same spirit as Phase 6 (integration verification)
  will do at a larger scale.
- **`CaptchaSessionRegistry.register()` still has no caller, so `onBound` is wired but never fires
  in practice.** This phase makes `relayCaptchaSession()` real and ready — screencast frames would
  actually flow, remote input would actually dispatch — but the trigger question flagged since
  Phase 0 (who decides a session needs human help, and calls `registry.register()`) is still open;
  no real captcha has ever been observed (`PostSubmitUnconfirmed`, Phase 1) to make that decision
  from. Not attempted here — inventing a trigger without a confirmed captcha-detection signal would
  be guessing at exactly the kind of thing this roadmap has repeatedly refused to guess at.
- **`CdpInputRelay`'s `resolved` signal has nothing to resume.** Its own Phase 2 docblock said
  "signal automation to resume... is Phase 4's job once there's an `index.ts` to wire it to" — but
  `automation/` has no pause-and-wait-for-human point in its flow at all (`checkAvailability` runs
  straight through to a `NavigationOutcome` and returns). `relayCaptchaSession()`'s `onResolved`
  callback just logs this rather than pretending to resume something that doesn't exist. Building a
  real pause point is blocked on the same open captcha-detection question as the item above, not a
  Phase 4 oversight.
- **`command.procedure`/`command.applicant` fields still don't get logged with correlation
  ids on failure** — `withErrorHandling` logs `commandId`/`watchTaskId` only, deliberately omitting
  `applicant` (would leak PII to worker stdout, the same concern `../application`'s
  `ApplicantDataDoesNotLeakToLogsTest` guards on the Laravel side). Full structured, correlated
  logging across both services is still Phase 5.

## Phase 5 — Hardening & observability ✅ done

- [x] Structured logging (correlate logs by session/command id). Added `src/logger.ts`:
      `Logger` (`info`/`error`/`withContext`) + a `ConsoleLogger` singleton. `withContext()` binds
      correlation fields once and every subsequent call carries them — the same idea as Laravel's
      own `Log::withContext([...])` (Phase 8, `RedisWorkerGateway.php`/
      `DispatchAvailabilityCheckJob.php`), and deliberately uses the *same field names*
      (`command_id`/`watch_task_id`, snake_case) even though the wire JSON stays camelCase, so both
      services' logs can be grepped by the same key for one `WatchTask`'s/command's journey — the
      exact thing `RedisWorkerGateway.php`'s own docblock said this was for. Plain `key=value`
      suffix, not JSON: Laravel's own logging isn't configured for structured JSON either (stock
      Monolog line formatter), so there's nothing on the other side to match by parsing JSON.
      Wired into `command-handler.ts` (logs `info` on every published event, `error` on an
      unexpected exception, both `withContext`-bound to `command_id`/`watch_task_id`),
      `redis-command-consumer.ts` (logs `error` when dropping a malformed payload — previously
      silent), and `index.ts` (replaces the ad-hoc `console.log`/`console.error` calls added in
      Phase 4, adds a `session_id`-bound logger for captcha relay connections).
- [x] Retry/backoff policy for transient site failures vs. hard failures (`CheckFailedEvent`
      semantics). The classification itself (`outcome-to-event.ts`) was already complete since
      Phase 3 — what this phase closes is the gap Phase 4's own write-up flagged: an uncaught
      exception from `checkAvailability` (a real Playwright crash, a network timeout — anything not
      already modeled as a `NavigationOutcome`) used to propagate out to `index.ts`'s
      `withErrorHandling`, which only logged it, leaving the command's `WatchTask` stuck with no
      event published at all. `command-handler.ts` now catches it and publishes a
      `retryable: true` `CheckFailedEvent` (`reason: "Unexpected error: <message>"`) — same
      conservative "unknown means retryable" choice `outcome-to-event.ts` already makes for
      `post_submit_unconfirmed`. No new backoff *timer* was added on this side: the actual retry
      cadence is Laravel's `watcher:dispatch-due-checks` schedule, already in place since
      `../application`'s Phase 4/8 — node-worker's whole job in this contract is correctly
      classifying `retryable`, not scheduling anything itself. `index.ts`'s `withErrorHandling`
      stays as a last-resort net for what even this can't catch (e.g. `eventPublisher.publish()`
      itself throwing because Redis is down).
- [x] Health signal for the container (used by compose/orchestration). Added
      `src/health-server.ts`: `HttpHealthServer`, a plain HTTP endpoint on the new
      `config.health.port` (`HEALTH_PORT`, default `4002` — separate from `cdpRelay.port` since
      that one speaks WS-only and closes anything that isn't a valid `/captcha-ws/<token>` path,
      which a healthcheck probe isn't) answering `200`/`{"status":"ok"}` or
      `503`/`{"status":"unhealthy"}` from an injected `isHealthy()` callback — same DI-factory
      idiom as `captcha/relay-server.ts`'s `WebSocketServerFactory`. `index.ts` wires it to
      `() => commandRedis.status === "ready" && eventRedis.status === "ready"` — cheap and
      synchronous on purpose; a deeper check of browser/session liveness isn't attempted since
      `SessionManager`'s interface doesn't expose that today, and inventing new API surface on an
      already-tested Phase 1 module just for this wasn't this phase's job. `docker-compose.yml`'s
      `node-worker` service gets a `healthcheck:` block (`node -e` hitting the endpoint directly —
      no `curl`/`wget` dependency needed on the Playwright base image — `interval: 10s`,
      `start_period: 15s` to cover first-boot Chromium launch + two Redis connections), matching
      the existing `db`/`redis` services' pattern.
- [x] Confirm behavior under `shm_size: 1gb` constraint (docker-compose already sets this for
      headless Chromium). Verified manually, not just theoretically: launched one real
      `chromium.launch()` inside the running dev container and opened `maxConcurrentSessions`
      (3) concurrent `BrowserContext`s/pages — the same one-browser-many-contexts shape
      `PlaywrightSessionManager` actually uses — each navigating to a `data:` URL with enough
      rendering weight (400 gradient `<div>`s, several forced layout/paint cycles per page,
      concurrently across all 3) to actually exercise shared memory, not just idle tabs. No crash;
      `df -h /dev/shm` inside the container confirms the full `1.0G` is mounted and available.
      `1gb` is confirmed sufficient for the current `maxConcurrentSessions` default — not proven
      for a much higher concurrency limit, which nobody has asked for.

**Verification for this increment:** `npm run typecheck`, `npm run lint`, `npm test` (171 tests, up
from Phase 4's 147 — new `logger.test.ts`/`health-server.test.ts` plus additions to
`command-handler.test.ts`/`redis-command-consumer.test.ts`/`config.test.ts`), and `npm run build`
all pass. `docker compose up -d node-worker` (config/healthcheck changes require this, not
`restart` — see `../cita-watcher-docker/CLAUDE.md`) picked up the new `healthcheck:` and the
container reached Docker's own `(healthy)` status within `start_period`. Log output from a real
run confirms the correlation fields actually appear:
`[node-worker] published worker event command_id=... watch_task_id=... type=check_failed
retryable=...`.

**Changes not in the original checklist / open follow-up:**
- **No JSON/structured-file logging, no log shipping.** "Structured" here means "consistently
  correlated and grep-able," matching what Laravel already does — not a new logging pipeline
  (Loki/ELK/etc.), which nobody asked for and neither service is set up to ship to today.
- **Health check is a liveness signal for the two Redis connections only**, not a full readiness
  probe of "can actually complete a check right now" (browser state, WAF cooldown, etc. aren't
  considered). Deepening it is future hardening work if the current signal turns out to be
  insufficient in practice — not assumed here.
- **`CaptchaSessionRegistry.register()` still has no caller** and **`CdpInputRelay`'s `resolved`
  signal still has nothing to resume** — both carried over unchanged from Phase 4's own write-up,
  still blocked on the same open captcha-detection question (Phase 0/1/2), not touched by this
  phase's logging/retry/health work.

## Phase 6 — Integration verification ⚠️ partially done — see notes

- [x] End-to-end dry run through `docker compose -f cita-watcher-docker/docker-compose.yml
      up -d`: Laravel enqueues a command → node-worker processes it → event lands back
      on Redis. Done 2026-08-05 — full runbook and observed output:
      `../docs/PHASE9_DRY_RUN.md`'s "Re-run with the real node-worker" section (this phase shares
      that runbook with `../docs/APPLICATION_ROADMAP.md` Phase 9 rather than duplicating one).
      Confirmed for real: `RedisCommandConsumer` picked up a Laravel-dispatched command within
      milliseconds, node-worker's `automation/` reached the real
      `icp.administracionelectronica.gob.es` over the network and parsed a real province page,
      `command-handler.ts`'s Phase 5 catch-all correctly turned a `TramiteNotFoundError` (the
      guessed trámite label wasn't real — no confirmed label has ever been recorded anywhere in
      this codebase) into a retryable `CheckFailedEvent`, and `event-consumer` received and handled
      it, sending the `WatchTask` back to `pending` — confirmed again minutes later when the
      *scheduler's own* periodic tick re-dispatched the same task automatically, unprompted, with
      the same result. Also found and fixed a real, unrelated, pre-existing bug this way:
      `event-consumer` had been silently crash-looping for almost a day on a Redis
      `read_timeout` default — see `PHASE9_DRY_RUN.md` for the full root-cause writeup.
      `check_completed`/`captcha_required`/a real slot listing were **not** observed in this dry
      run — that needed a confirmed real trámite label, which was unstarted recon at the time. See
      the follow-up note directly below: that recon has since happened, by hand, outside node-worker
      entirely.
- [ ] Manual captcha-solving walkthrough through the `/captcha-ws/` relay via nginx. **Still not
      attempted, for a narrower reason than when this line was first written.** At the time,
      `CaptchaSessionRegistry.register()` had no caller and the screencast UI didn't exist at all —
      both are now done (`register()`'s caller: Phase 7 below; the UI:
      `application/public/captcha.html`, `../docs/APPLICATION_ROADMAP.md` Phase 11). What's left
      isn't missing machinery, it's that nobody has actually pointed a human at a real captcha
      through this now-complete pipeline — doing so for real means letting the flow attempt an
      actual reservation on the live government site, which hasn't been done as part of routine
      verification work. Nothing to check off here until that live run actually happens.
- [x] Model the confirmed post-identity-form wizard (options menu → `acCitar` → `acOfertarCita`) in
      `site-navigator.ts`, and make `fillApplicantForm` trámite-aware. Done 2026-08-05, same day as
      the manual recon below, as a deliberately scoped follow-up to it (confirmed with the user
      beforehand: model navigation only, no session-pause/human-in-the-loop work, no wire-contract
      changes). New `CaptchaBlockedSlotsOffered`/`OfferedSlot` outcome type — local to
      `site-navigator.ts`, not a reuse/mutation of the wire-facing `AppointmentSlot` from
      `../types/check-result.ts`, since the real office only appears on the still-unmodeled
      `acVerificarCita` step and this type can't honestly carry one. New `DocumentTypeNotOfferedError`/
      `PhoneRequiredError` domain errors (a trámite not offering the requested document-type radio,
      or a `WatchTask`'s `applicant.phone` being `null` when the site turns out to require one, are
      real client/config mismatches — not unrecognized-page-state territory, so they're thrown, not
      returned as a new `NavigationOutcome`). `outcome-to-event.ts` gained a matching switch case
      mapping the new outcome to a `retryable: true` `CheckFailedEvent` with a reason string naming
      the slot count — deliberately **not** `CaptchaRequiredEvent`, which still carries no session
      token (see below) and would claim actionability nothing downstream has. 179 tests pass (up
      from 171); `tsc`/`eslint`/`npm run build` all clean. Deliberately does **not** touch
      `availability-checker.ts`'s acquire→run→release-in-finally shape — everything happens
      synchronously within the one already-acquired `Page`, so nothing needed to suspend across an
      external async wait for this scope.

**Manual recon (2026-08-05, by hand in a real browser, not via node-worker):** with automated
outbound access from the dev environment blocked by a local network's intrusion-prevention policy,
a human walked the live site directly and reported results back turn by turn. This resolved the
trámite-label and captcha unknowns above without writing or running any node-worker code — full
account (including the surprising bits): `../docs/PHASE9_DRY_RUN.md`'s "Manual browser recon"
section. Headline findings, all confirmed live, not guessed:
- A real, confirmed trámite label exists and works: `POLICIA - RECOGIDA DE TARJETA DE IDENTIDAD DE
  EXTRANJERO (TIE)`, province Alicante (`icpco`, `p=3`), office "CNP Benidorm TIE". A second
  trámite in the same province, `POLICÍA-TOMA DE HUELLAS...`, hit `RequiresClave` instead —
  confirming trámite-level Cl@ve gating is real, not just theorized from the file-level comment in
  `site-navigator.ts`.
- **The real booking flow is a 5-step wizard**, not the single "fill form → submit → done" shape
  `site-navigator.ts`'s `runAvailabilityCheck` currently models. After the applicant-identity form
  (`acEntrada`/`acValidarEntrada`) there's an options menu, then `acCitar` (Paso 2/5: phone+email),
  `acOfertarCita` (Paso 3/5: real slot list **and the first captcha ever observed in this
  project**), `acVerificarCita` (Paso 4/5: a review/confirm screen), and `acGrabarCita` (final
  commit, never reached in this session).
- **The applicant-identity form's field set is trámite-dependent**, not fixed: this trámite's form
  only asked for N.I.E. + name — no birth year, no nationality, and only one document-type radio
  (N.I.E.), not the three `fillApplicantForm` unconditionally expects. `fillApplicantForm` as
  written would hang or throw on this real page looking for fields that don't exist on it.
- **The captcha itself is a simple ~6-character alphanumeric image challenge** (the site's own
  `eu-captcha` widget), with an audio alternative and a reload link — not a picture-grid or anything
  exotic. Good news for `captcha/`'s existing screencast+input-relay design, which was built around
  exactly this kind of "human reads an image, types text" interaction.
- **A hard, server-enforced 5-minute completion window** starts once the captcha/slot-list step
  loads. It's not just a UI countdown: letting it lapse doesn't produce an error — the final submit
  silently no-ops and bounces back to province selection. Confirmed live: no appointment was
  actually reserved in this session, specifically because the window expired before `acGrabarCita`.
  This is a real constraint on how fast a human has to react once a captcha relay session is live.

**Update, same day:** steps 1-3 of the wizard (options menu → `acCitar` → `acOfertarCita`) and the
trámite-aware applicant form are now implemented — see the checklist item above. **Still open, and
explicitly out of scope for that change:** `acVerificarCita`/`acGrabarCita` (steps 4-5 — never
cleanly observed live either, see the 5-minute-timeout finding above) are still unmodeled; and —
the actual remaining blocker on the manual-captcha-solving-walkthrough checklist item — nothing
pauses the session for a human to solve the captcha yet. That needs `availability-checker.ts`'s
acquire→run→release-in-finally shape to change (the session can't just be released mid-wizard while
waiting on an external WS connection), `CaptchaSessionRegistry.register()` to gain a real caller,
and `CaptchaRequiredEvent`'s wire shape to grow a session token/URL — in lockstep with the matching
Laravel-side `CaptchaInterventionRequiredEvent`/`HandleCaptchaRequiredUseCase` change on the
`../application` side. None of that has been started.

## Phase 7 — Pause a session for a human to solve a real captcha (node-worker side) ⚠️ partially done — see notes

- [x] `availability-checker.ts`'s `checkAvailability` no longer auto-releases the session for a
      `captcha_blocked_slots_offered` outcome — it returns `{ outcome, pendingCaptchaSession }`,
      handing the still-live `AutomationSession` to the caller instead of tearing it down. Every
      other outcome (including a thrown error) still releases exactly as before.
- [x] `captcha/session-registry.ts`'s `CaptchaSessionRegistry.register()` now has a real production
      caller for the first time since Phase 0/2. `register()` gained an `onResolved` callback
      parameter and the registry gained `notifyResolved()`, becoming the actual bridge between the
      WS relay side (`index.ts`'s `relayCaptchaSession`, which now calls `notifyResolved(token)`
      when `CdpInputRelay` sees a `"resolved"` message — previously a log-only stub) and the side
      genuinely waiting on a human (`messaging/command-handler.ts`).
- [x] `messaging/command-handler.ts`: on `captcha_blocked_slots_offered`, generates a `SessionToken`,
      publishes `CaptchaRequiredEvent{sessionToken}` immediately (before waiting, so a human learns
      about it promptly), registers the paused session, then awaits either `notifyResolved()` or a
      new configurable timeout (`CAPTCHA_RESOLUTION_TIMEOUT_MS`, default 4 minutes — deliberately
      under the confirmed real ~5-minute site window and under nginx's `proxy_read_timeout 300s` on
      `/captcha-ws/`), release+unregister always in a `finally`. Deliberately publishes nothing
      further after resolution/timeout — node-worker has no visibility into what a human actually
      did over the CDP relay, and this codebase consistently avoids reporting a guess as an
      observation. `createWorkerCommandHandler` was refactored from 5 positional params to a single
      `WorkerCommandHandlerDeps` options object as part of this — the growing collaborator list
      (now `captchaRegistry` plus a token generator/timer for testability) had outgrown positional
      args, and every call site needed updating for the new captcha branch anyway.
- [x] Found and fixed a real, previously-inert infra bug this surfaced: `cita-watcher-docker/nginx/
      default.conf`'s `location /captcha-ws/ { proxy_pass http://node-worker:4001/; ... }` had a
      trailing slash on `proxy_pass`, which makes nginx strip the matched `/captcha-ws/` prefix
      before forwarding — node-worker would have received `/<token>` instead of
      `/captcha-ws/<token>`, which `extractSessionToken`'s `RELAY_PATH_PREFIX` check would reject.
      Fixed by dropping the trailing slash so nginx forwards the original URI unchanged.
- [x] 191 tests pass (up from 179); `tsc`/`eslint`/`npm run build` all clean.
- [x] **Was deliberately deferred, confirmed with the user beforehand; now done**: the Laravel-side
      half of this contract change. `WorkerEventRouter::routeCaptchaRequired()` now reads the
      `sessionToken` field, a new `Application/Watcher/Ports/CaptchaSessionUrlBuilderInterface` /
      `Infrastructure/Watcher/Captcha/LaravelCaptchaSessionUrlBuilder` builds the actual
      `{APP_URL}/captcha-ws/{sessionToken}` link (node-worker still deliberately doesn't know
      Laravel's public URL, so it still only publishes the bare token), and a new
      `NotifyOnCaptchaInterventionRequiredListener` notifies a human through the `WatchTask`'s
      configured channel, reusing the existing `SendNotificationUseCase` pattern. Full write-up:
      `../docs/APPLICATION_ROADMAP.md` Phase 10.
- [ ] The manual captcha-solving walkthrough itself (Phase 6's second item) is **still** genuinely
      blocked even after this phase and after `../docs/APPLICATION_ROADMAP.md` Phase 10 — a human is
      now actually told the real `/captcha-ws/<token>` URL, but opening it does nothing yet,
      and the human-facing screencast UI is still undesigned (root `../CLAUDE.md` non-goal). Nothing
      to check off here until both exist.

## Phase 8 — Classify the page after a human resolves a captcha ✅ done

Follow-up to Phase 7, prompted by re-reading how the CDP relay (`../captcha/input-relay.ts`)
actually works: it forwards raw, unscoped `Input.dispatchMouseEvent`/`dispatchKeyEvent` calls for
the *whole* live page, not just a captcha text field, and `CdpScreencastFrameRelay` streams the
full page video alongside it. So a connected human doesn't just answer a captcha — once the
still-undesigned screencast UI exists, they get full remote-control of the browser and would click
through whatever's left of the 5-step wizard themselves (`acVerificarCita`/`acGrabarCita`
included), then send `"resolved"` when done. This means node-worker doesn't need to *automate*
those two steps — `command-handler.ts` just needed to react to `"resolved"` at all, which until now
it didn't (it only logged the resolution, then released the session and returned, publishing
nothing further — see Phase 7's own docblock note in `command-handler.ts`, now superseded).

- [x] New `site-navigator.ts` export `classifyPostResolutionOutcome(page, province)`, called from
      `command-handler.ts` only when `resolution === "resolved"` (never on our own `"timeout"` — a
      timeout on our side isn't an observation of the page, so classifying it would be exactly the
      kind of guess this codebase consistently avoids presenting as fact). Reuses the existing
      `detectWafRejection` and compares `page.url()` against `buildCitarUrl(route)` — the exact URL
      `runAvailabilityCheck` originally navigated to for this same command — to detect the **one**
      confirmed-by-recon failure mode (`docs/PHASE9_DRY_RUN.md`'s "Manual browser recon": the site's
      hard 5-minute window expiring silently bounces back to that same URL, with no error and no
      reservation made). New `ReservationWindowExpired` type + `PostResolutionOutcome` union
      (`WafRejected | ReservationWindowExpired | PostSubmitUnconfirmed`) — deliberately **not**
      folded into `NavigationOutcome`, since `runAvailabilityCheck` itself never returns it.
- [x] **Deliberately does not** attempt to detect or automate the "Estoy conforme" checkbox, the
      `acVerificarCita`/`acGrabarCita` submit buttons, or any success screen — none of those have
      ever been confirmed live (only the timeout-bounce failure mode has), and this codebase's
      established convention (`PostSubmitUnconfirmed`, every `isVisible().catch(() => false)`
      detector in `site-navigator.ts`) is to never guess at unconfirmed selectors, especially not
      for a step that submits a real, irreversible reservation on a real government site. Any other
      post-resolution page state — including a real success, which has never been observed — falls
      through to `post_submit_unconfirmed`, same honest-uncertainty choice the rest of the file
      already makes.
- [x] New `messaging/outcome-to-event.ts` export `mapPostResolutionOutcomeToCheckFailedEvent`, same
      shape/pattern as `mapNavigationOutcomeToCheckFailedEvent`, all three cases `retryable: true`.
      `CheckCompletedEvent` still isn't published anywhere in the codebase — unchanged by this
      phase, for the same reason as always: no confirmed success page to key off of.
- [x] `command-handler.ts`: on `resolution === "resolved"`, calls `classifyPostResolutionOutcome`
      against `pendingCaptchaSession.page` and `request.province`, maps it, and publishes the
      result — the first and only additional event a captcha-paused command can now produce beyond
      `CaptchaRequiredEvent`. Runs inside the same inner `try`/`finally` as the rest of the captcha
      branch, so a thrown error here (e.g. a crashed page) still reaches the outer catch and
      degrades to the existing `retryable: true` "unexpected error" `CheckFailedEvent`, and
      `unregister`/`release` in `finally` are unaffected either way.
- [x] 207 tests pass (up from 199); `tsc`/`eslint` both clean.

**Still open, unchanged by this phase:** at the time this phase landed, the screencast UI didn't
exist yet, so nothing had actually driven this code against a live `"resolved"` signal. That's since
changed — `application/public/captcha.html` (`../docs/APPLICATION_ROADMAP.md` Phase 11) is a real
page now — but the manual captcha-solving walkthrough itself (Phase 6/7's last checklist item)
remains open regardless, since running it for real means attempting an actual reservation.
`acVerificarCita`/`acGrabarCita`'s real DOM, the "Estoy conforme" checkbox, and any real success
screen remain completely unconfirmed — this phase deliberately did not commission new recon to fill
that in, per the trade-off discussed with the user before starting (see the `AskUserQuestion`
decision: model only the confirmed failure mode, `post_submit_unconfirmed` for everything else,
rather than guessing at selectors for an irreversible real-world booking action).

## Phase 9 — Live booking attempt: bot-defense root-caused, remote-response logging shipped ⚠️ partially done — see notes

Prompted by an actual attempt (2026-08-08) to drive the real booking flow for `POLICIA - RECOGIDA
DE TARJETA DE IDENTIDAD DE EXTRANJERO (TIE)` / Alicante / "CNP Benidorm TIE" end-to-end with a real
developer's own real applicant data, using a throwaway, uncommitted script (`node-worker/tmp-live-
book.ts`, copied into the running dev container and deleted after each run — never part of the
source tree) that reused real project code (`province-routes.ts`, `document-id-validator.ts`, and
this phase's own `remote-response-logger.ts`) rather than reinventing it, but added office (`sede`)
selection and post-captcha steps `site-navigator.ts` doesn't model yet. This did **not** land a real
booking — see "Still open" below — but it corrected a wrong conclusion on record since Phase 6, and
shipped one real, permanent feature.

- [x] **Corrects a wrong claim on record since Phase 6**: `../docs/PHASE9_DRY_RUN.md`'s "Manual
      browser recon" section attributed automated recon being blocked to "a FortiGate Intrusion
      Prevention block at the local network level (not the site's own WAF)". Live testing today
      disproves that: `curl` from inside the very same `node-worker` container, on the very same
      network, reaches the real origin cleanly (legitimate DigiCert-issued cert for
      `icp.administracionelectronica.gob.es`, not a MITM'd one) and gets back the site's *own*
      bot-management layer — an F5/Shape-style JS challenge (cookie prefix `TSPD`, script path
      `/TSPD/...`) for a plain UA, or its "Request Rejected" support-ID page for a bot-flagged one.
      Only Playwright's own headless Chromium got the literal "FortiGate Intrusion Prevention
      Violation" page, and only when its User-Agent string contained `HeadlessChrome` — i.e. this was
      the *target site's* bot defense reacting to a headless-browser fingerprint, branded however
      that vendor brands its block page, not a firewall on this project's own network. See the
      correction note added directly to `../docs/PHASE9_DRY_RUN.md` at the original claim.
- [x] **Confirmed live, once**: launching Chromium `headless: false` under `xvfb-run` (Xvfb + the
      `xvfb-run` wrapper are already present in the node-worker dev image), with a plain desktop
      Chrome `User-Agent` override and `navigator.webdriver` patched to `undefined` via
      `page.addInitScript`, gets past the bot defense and reaches the real page
      ("Proceso automático para la solicitud de cita previa") with real `<select>` content. Plain
      `headless: true` (with or without the same UA/webdriver overrides) never did, across every
      attempt. **This is a real, still-open gap in production code, not just a recon inconvenience**:
      `automation/session-manager.ts`'s `defaultLauncher` is `chromium.launch({ headless: true })`
      with none of this — as written today, a real `WorkerCommand` processed by the real running
      service would almost certainly hit the same block on the real site. Fixing that (headed +
      Xvfb + fingerprint overrides in `session-manager.ts` itself, plus whatever container/compose
      changes that implies — a permanent Xvfb dependency, display-less rendering resource cost,
      etc.) is real follow-up work, **not done as part of this phase** — this phase only diagnosed
      and confirmed the shape of the problem via a throwaway script, deliberately not folded into
      production code without a separate decision on that trade-off.
- [x] **Confirmed live**: the `sede` (office) `<select id="sede" name="sede" onchange="cargaTramites()">`
      is a real, visible native `<select>` (contrary to an initial guess that its
      `data-live-search="true"` attribute meant a hidden custom widget) — but selecting it via
      Playwright's `selectOption(..., { force: true })` breaks the page's own `cargaTramites()` AJAX
      reload of the trámite `<select>`s: the `force: true` path skips Playwright's normal
      actionability/event dispatch, and the site's own bot defense silently rejects that AJAX call
      (returns its JS-challenge document instead of a trámite list), leaving the trámite `<select>`
      empty. Plain `selectOption({ value: ... })` (no `force`, and by `value` rather than `label` —
      the real option text contains a `` ` `` character that didn't reliably string-match) works and
      the AJAX call succeeds for real. Relevant if `session-manager.ts` or `site-navigator.ts` ever
      grows real `sede` selection (today `runAvailabilityCheck` never touches `sede` at all, so every
      real check runs against "Cualquier oficina").
- [x] **Corrects/extends Phase 6's "Alicante only offers policía trámites" claim**: live today,
      Alicante (`icpco`, `p=3`) actually has four real `<select>`s — `sede` (14 real offices, e.g.
      "CNP Alicante TIE", "CNP Benidorm TIE"), `tramiteGrupo[0]` (14 extranjería trámites, not
      previously recorded at all), `tramiteGrupo[1]` (12 policía trámites — the 3 Phase 6 recorded
      were an undercount from a human's live-browser recon session, not a wrong reading, just an
      incomplete one), and an always-empty-at-this-point `subtramite`. Selecting a specific `sede`
      (e.g. "CNP Benidorm TIE") filters `tramiteGrupo[1]` down to 13 options via the same
      `cargaTramites()` AJAX call above — `POLICIA - RECOGIDA DE TARJETA DE IDENTIDAD DE EXTRANJERO
      (TIE)` is confirmed present in that filtered list for "CNP Benidorm TIE" specifically.
- [x] **New, real, permanent feature**: `automation/remote-response-logger.ts`'s
      `attachRemoteResponseLogging(page, logger, options?)` — grew directly out of needing to tell a
      broken bot-defense JS challenge apart from a WAF block, a Cl@ve redirect, or a genuinely slow
      page, which a bare `NavigationOutcome` or a thrown error can't distinguish on its own. Attaches
      `response`/`pageerror`/`console` listeners to a `Page`: every HTTP response from the target
      site's own hostname (`icp.administracionelectronica.gob.es` by default, overridable via
      `options.hostnames`) logs as `remote response <status>` (`info` under 400, `error` at/above),
      filtered by hostname so CDN assets/Google Analytics/Dynatrace RUM beacons the real page loads
      don't drown it out; every uncaught page-JS error logs as `remote page uncaught JS error`; every
      browser-console `error`/`warning` (not `log`/`info`) logs as `remote page console <type>`.
      `availability-checker.ts`'s `checkAvailability` gained an optional 4th `logger` param (and a
      5th, injectable `attachLogging` function for tests) — attachment is opt-in on `logger` being
      passed, deliberately not unconditional, since existing tests exercise `checkAvailability`
      against a bare `{} as Page}` fake with no `.on()`. `messaging/command-handler.ts` now passes
      its own `commandLogger` (already bound to `command_id`/`watch_task_id` via
      `logger.withContext()`) through, so **every real check a running node-worker service performs
      now logs the target site's actual HTTP responses and JS/console errors, correlated by the same
      `command_id`/`watch_task_id` as every other node-worker log line** — visible the same way as
      any other node-worker log: `docker compose logs -f node-worker` against the real running
      service (or, for a container not run under compose, wherever that process's stdout/stderr
      lands). Not a new log file, not a new destination — same `Logger`/`ConsoleLogger` singleton
      (`../../node-worker/src/logger.ts`) every other node-worker log line already goes through.
      7 new tests for the logger itself (hand-built `Page`/`ConsoleMessage`/`Response` fakes, same
      idiom as the rest of `automation/`), 3 new tests for the `checkAvailability` wiring; two
      existing `command-handler.test.ts` fakes (`fakeSession`'s default page, `fakePostResolutionPage`)
      needed a no-op `on: vi.fn()` added, since they now flow through real attachment. 209 tests pass
      (up from 207); `tsc`/`eslint` both clean.
- [ ] **Still open — the live booking walkthrough remains blocked, for a different, now-diagnosed
      reason.** Three live attempts today against the real site, using the confirmed headed+Xvfb+UA/
      webdriver-override recipe above: the very first (before the `sede` `force`-vs-plain fix above
      was known) failed at trámite lookup because of the `force: true` AJAX-breaking bug. The next
      two — after that fix, and after `remote-response-logger.ts` existed to actually show what was
      happening — both failed *earlier*, before `sede` selection: the page's own bot-defense JS
      challenge returned HTTP 200 but threw an uncaught `__name is not defined` and never completed
      its own redirect to the real page (`remote page uncaught JS error message=__name is not
      defined`, `select#sede` never appearing). This is a **new** failure mode, distinct from both
      the original wrong "network firewall" claim and the headless-fingerprint block the first
      finding above diagnoses — it reproduced identically twice in a row after the one earlier
      success today, consistent with (not proven to be) the same source IP's reputation with the
      site's bot defense having been degraded by the volume of automated requests this same debugging
      session generated, including several with `force: true`/headless fingerprints likely to read as
      bot-like. **No real applicant data (N.I.E./name/phone/email) was ever actually submitted to the
      site in any of the three attempts** — all three failed at or before trámite/office selection,
      never reaching the applicant form (`acEntrada`). The throwaway script and the one-off applicant-
      data file it read from were deleted after each run; nothing from this stayed in the repo.
      Resolving this for real — whether that means waiting out whatever reputation window this is,
      trying from a different network/IP, or something else entirely — is unstarted, follow-up work.

## Phase 10 — Ship Phase 9's diagnosis: anti-detection browser launch + real sede selection ⚠️ partially done — see notes

Direct follow-up to Phase 9, same day: Phase 9 only diagnosed the bot-defense/`sede` findings via a
throwaway script; this phase puts the confirmed fixes into the actual production code path.

- [x] `automation/session-manager.ts`'s `defaultLauncher` now launches `chromium.launch({ headless:
      false, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] })` instead of
      plain `headless: true`, and `acquire()` now creates every context with a desktop-Chrome
      `userAgent` and a `navigator.webdriver`-patching `addInitScript` — the exact recipe Phase 9
      confirmed live gets further than plain headless (never confirmed to work at all). New test
      asserts the `User-Agent` never contains `HeadlessChrome` and that `addInitScript` is called.
      `tsconfig.json`'s `lib` stays `["ES2023"]` (no DOM) — `navigator` inside the init-script
      callback gets a minimal local `declare const navigator: { webdriver?: boolean }` instead of
      pulling in the full DOM lib for one property.
- [x] `../cita-watcher-docker/node-worker/Dockerfile`'s `CMD` and `docker-compose.yml`'s node-worker
      `command:` override both now wrap the process in `xvfb-run -a` (already bundled in the
      Playwright base image) — `headless: false` needs a `DISPLAY`, and unlike the throwaway
      recon scripts (`xvfb-run -a node ...`, run via `docker compose exec` into an already-running
      container), the real service is the container's own long-running entrypoint.
- [x] **Found and fixed a real, live infra bug this surfaced**: with `xvfb-run` as the container's
      own PID 1, the service hung forever on startup — confirmed live via `docker exec ... ps aux`:
      Xvfb itself started fine (its own `/tmp/.X99-lock` existed), but `xvfb-run`'s wrapper script
      never proceeded past its internal `wait` for Xvfb's ready signal (`SIGUSR1`), a known class of
      PID-1 signal-handling gotcha in containers with no real init. Fixed by adding `init: true` to
      the `node-worker` compose service (Docker Compose's built-in minimal `tini` init) — verified
      live: `docker-init` now owns PID 1, `xvfb-run` → `npm run dev` → `tsx watch src/index.ts` all
      come up, and the service reports `healthy` with its normal startup log line
      (`started commands_list=... ws_relay_port=4001 health_port=4002`).
- [x] `site-navigator.ts`: new optional `CheckAvailabilityRequest.sede` field (visible `<select
      id="sede">` option text, same "caller supplies the exact real Spanish text" contract as
      `tramiteLabel`) and a new `selectSede()` step, run before trámite selection — confirmed live in
      Phase 9 that a specific trámite (recogida de TIE) only appears in the trámite `<select>` once
      the right `sede` is chosen first, via the site's own `cargaTramites()` AJAX reload. Uses plain
      `selectOption` (never `force: true` — see Phase 9's write-up for why that breaks the AJAX
      call), throws a new `SedeNotFoundError` for an unmatched label, mirroring `TramiteNotFoundError`.
      **Deliberately optional and backward-compatible**: omitting `sede` reproduces every prior
      confirmed behavior exactly (site defaults to "Cualquier oficina"), so this doesn't risk any
      trámite that was already working without office selection.
- [x] 214 tests pass (up from 209 at the end of Phase 9); `tsc`/`eslint` both clean.
- [x] **Was not done here — closed in Phase 11 below.** `messaging/command-handler.ts`
      built `CheckAvailabilityRequest` from `command.procedure.province`/`.tramiteCode` only, with no
      `sede` on `../types/commands.ts`'s `Procedure` and no matching field on the Laravel-side
      `Procedure.php`/`WatchTask` schema/API. A real `WatchTask` created through the actual API could
      not specify an office. See Phase 11 for the both-sides-in-lockstep fix (same shape as
      `ApplicantData`'s `documentType`/`birthYear`/`nationality` fields, Phase 3).
- [ ] **Not done — no new live attempt against the real site.** This phase shipped and unit-tested
      the fixes Phase 9 diagnosed, and confirmed the real service starts up correctly with them, but
      deliberately did not run another live booking attempt to confirm they resolve Phase 9's actual
      blocker end-to-end — see Phase 9's closing note on the likely-degraded IP reputation from that
      day's volume of automated requests; spending another live attempt to verify wasn't done without
      a fresh decision to do so.
- [ ] **Still open, unchanged**: the manual captcha-solving walkthrough (real human, real captcha,
      through `captcha.html`) and real success-page detection (`CheckCompletedEvent` never
      published) — neither is closer to done than at the end of Phase 8/9. Both need an actual live
      run that reaches the captcha step, which this phase's code changes may or may not now allow;
      unconfirmed either way.

## Phase 11 — Ship `sede` into the cross-service wire contract ✅ done

Closes the gap Phase 10 flagged: `site-navigator.ts`'s `selectSede()` existed since Phase 10, but
nothing upstream of it could ever populate `CheckAvailabilityRequest.sede`, since neither the
node-worker wire type nor the Laravel domain/API carried a `sede` field. This phase is the
both-sides-in-lockstep change, same shape as `ApplicantData`'s `documentType`/`birthYear`/
`nationality` fields (Phase 3).

- [x] `../types/commands.ts`'s `Procedure` gained an optional `sede?: string` — same "caller
      supplies the exact real Spanish `<select>` option text, omitted means the site's own
      `"Cualquier oficina"` default" contract as `CheckAvailabilityRequest.sede` already had.
- [x] `messaging/worker-command-parser.ts`'s `parseProcedure` validates `sede` as string-or-absent
      (rejects any other type) and only includes the key on the parsed `Procedure` when present —
      matches `tsconfig.json`'s `exactOptionalPropertyTypes` rather than ever assigning it
      `undefined` explicitly.
- [x] `messaging/command-handler.ts` forwards `command.procedure.sede` into the `checkAvailability`
      request only when defined (conditional spread, not `sede: command.procedure.sede`, for the
      same `exactOptionalPropertyTypes` reason).
- [x] **Laravel-side half, same increment**: `Domain/Watcher/ValueObjects/Procedure.php` gained an
      optional `?string $sede = null` (no blank-validation, same pattern as `ApplicantData::$phone`);
      the `watch_tasks` migration gained a nullable `sede` column (edited in place — the table still
      holds no real data, same convention as Phase 6's `ApplicantData` migration edit);
      `EloquentWatchTaskRepository`/the `WatchTask` Eloquent model's `#[Fillable]` map it through;
      `CreateWatchTaskRequest` validates `'sede' => ['nullable', 'string']`; `WatchTaskController`
      passes it into `Procedure`; `WatchTaskResource` echoes it back under `procedure.sede` (not
      sensitive, unlike `documentId` — same reasoning as `province`/`tramiteCode` already being
      echoed). `WorkerCommand::forAvailabilityCheck()` now builds `procedure` via `array_filter()`
      so the key is omitted from the wire payload entirely when `sede` is `null`, mirroring the
      node-worker parser's own "absent, not null" convention for this field.
- [x] 218 node-worker tests pass (up from 214); 154 Laravel tests pass (up from 150); `tsc`/`eslint`
      and Pint both clean.
- [ ] **Not done — no new live attempt against the real site.** This phase is a pure wire-contract
      change, verified with unit/feature tests only; it doesn't touch `session-manager.ts`'s launch
      recipe or re-attempt Phase 9/10's diagnosed bot-defense blocker. A `WatchTask` created with a
      real `sede` still hasn't been proven, live, to actually reach the trámite this unlocks.

## Phase 12 — Live retry with real `sede`: root-caused why it still failed, found the label is short by an address ⚠️ partially done — see notes

Direct follow-up, same day as Phase 11 shipped: an actual live retry of the recogida-de-TIE booking
attempt (`watch_task_id=3`, the same real developer's real applicant data from Phase 9, this time
using the real HTTP API + real Redis-driven service end-to-end, not a throwaway script) against
`Alicante` / `POLICIA - RECOGIDA DE TARJETA DE IDENTIDAD DE EXTRANJERO (TIE)` / `sede: "CNP Benidorm
TIE"`.

- [x] **Found and fixed a real dev-environment bug, application-side**: this dev Postgres DB had
      already run `2026_08_01_120000_create_watch_tasks_table.php` *before* Phase 11 edited it to add
      `sede` — contradicting that phase's own assumption ("the table still holds no real data").
      `watch_tasks` already held a real row (`id=3`) with real encrypted applicant data. Fixed with a
      one-off `Schema::table('watch_tasks', ...)` `ALTER` run directly against the live dev DB (not a
      new migration file — the create-table migration already declares `sede` correctly for any
      fresh install/CI run; a second migration adding the same column would break those). See
      `../docs/APPLICATION_ROADMAP.md` Phase 13 for the Laravel-side note on this.
- [x] **Confirmed live, and it's a real bug, not reputation noise**: the `sede` value used
      everywhere on record since Phase 9/10 (`"CNP Benidorm TIE"`) is not the office `<select>`'s
      real option text. The real text includes the branch address:
      `"CNP Benidorm TIE, Callosa D\`Ensarria, 2, Benidorm"` — confirmed by dumping all 15 real
      `select#sede` options live. `selectSede()`'s exact-match `optionLabels.includes(sede)` was
      always going to fail against the short form. Phase 9/10's own recorded examples
      (`"CNP Alicante TIE"`, `"CNP Benidorm TIE"`) were themselves incomplete transcriptions from
      that day's live recon, not a copy error introduced later. `watch_task_id=3`'s `sede` has been
      corrected to the full string as an immediate, real-data fix (not a code change — this is a
      per-`WatchTask` data-quality issue, not something `site-navigator.ts` should special-case).
- [x] **Confirmed live**: `select#sede`'s options are populated asynchronously, after a client-side
      reload the bot-defense challenge triggers once it resolves (`page.on("framenavigated")` fired a
      second time for the *same* URL, a few seconds after the initial `domcontentloaded`) — the first
      response body's `#sede` has **zero** `<option>`s. `runAvailabilityCheck` does not wait for this;
      it navigates with `waitUntil: "domcontentloaded"` and immediately calls `selectSede`/
      `selectTramite`. This did not visibly matter for `selectSede` in this session's traces (Playwright's
      own `selectOption` actionability retry loop stays parked on the locator "waiting for options" for
      up to its 30s timeout, which is longer than the observed ~2s challenge-reload window), but it's
      a real, unhandled race, not just a theoretical one — worth a real fix (waiting for a non-empty
      `select#sede option` count, not just DOM presence of the `<select>` tag) rather than continuing
      to rely on timeout-retry luck.
- [x] **Fixed, same-day direct follow-up, test-first**: `site-navigator.ts` no longer trusts a single
      `allTextContents()` read. A new `pollUntil()` helper (bounded by `OPTIONS_POLL_MAX_ATTEMPTS`
      attempts × `OPTIONS_POLL_INTERVAL_MS`, ~10s total — attempt-count-bounded rather than
      wall-clock-bounded, deliberately, so tests using a no-op `waitForTimeout` fake run every attempt
      with no real delay instead of racing `Date.now()`) wraps both `selectSede`'s existence check and
      `selectTramite`'s search loop, retrying until a match appears or the budget runs out. Two new
      tests reproduce the exact race confirmed live (a locator whose `allTextContents()` resolves to
      `[]` on its first call(s), then the real populated list) and assert the eventual selection
      succeeds; all pre-existing `SedeNotFoundError`/`TramiteNotFoundError` tests still pass unchanged
      (a genuinely-absent label now polls the full budget before throwing, instead of failing on the
      first read, but still throws the same error). 220 tests pass (up from 218); `tsc`/`eslint` clean.
      `node-worker` was restarted to pick this up (the running `tsx watch` process didn't visibly
      hot-reload off the bind-mounted source change), which also discarded the long-lived,
      today's-retries-worth-of-history browser process the previous finding flagged as a possible
      reputation factor — a side benefit, not the fix itself.
- [x] **Confirmed, directly comparing a fresh throwaway browser vs. the long-lived production
      `PlaywrightSessionManager` browser**: three same-request live attempts through the real
      Redis-driven service, all with the corrected wire contract, returned three *different* error
      shapes (`TramiteNotFoundError`, then again `TramiteNotFoundError`, mechanically inconsistent
      with the confirmed exact-label mismatch, which should deterministically throw
      `SedeNotFoundError`), while an isolated throwaway script — same launch recipe, same request
      shape, brand-new browser process each run — deterministically threw the *expected*
      `SedeNotFoundError`. This is new, direct evidence for Phase 9's "IP-reputation-related" theory:
      the one variable that differs between the two is the browser process's/IP's accumulated request
      history against the site today, not the code path. Not conclusively isolated (network vs.
      browser-process reputation vs. something else); flagged, not resolved.
- [x] **Separately, the actual goal of this session's `watch_task_id=3` (a real appointment for this
      trámite/office) was reached the same day — but manually, by the developer navigating the real
      site directly in a browser, not through node-worker.** This is the project's first-ever
      confirmed real "cita confirmada" success page. Structure observed (own applicant/appointment
      data redacted below, only field labels and layout are real):
      ```
      CITA PREVIA EXTRANJERÍA
      <trámite label>
      CITA CONFIRMADA
      Nº de Justificante de cita: <8-char alphanumeric>
      Titular <redacted> - <redacted>
      Teléfono <redacted>
      Correo electrónico <redacted>
      DATOS DE LA CITA
      Dirección <sede's full address>
      Día de la cita <DD/MM/YYYY>
      Hora cita <HH:MM>
      Mesa <redacted>
      OTROS DATOS
      Fecha de reserva de la cita: <DD/MM/YYYY>
      NOTA: [document checklist reminder text]
      Tu cita ha sido confirmada. Deberás aportar este justificante el día de la cita.
      IMPORTANTE: [justificante-number custody warning]
      [cancellation instructions, referencing an "Anular Cita" flow gated behind re-entering identity]
      ```
      Real, valuable signal for whenever `CheckCompletedEvent`/real success detection
      (`classifyPostResolutionOutcome`'s still-unhandled "anything else" fallthrough, see Phase 8)
      gets built: "CITA CONFIRMADA" plus a "Nº de Justificante de cita" label look like a reliable,
      distinctive detection target — much more specific than guessing at a generic "success" page
      shape. **Not itself evidence that node-worker's own flow (`acVerificarCita`/`acGrabarCita`,
      still unmodeled per Phase 8's note) would produce the same page** — this was a human clicking
      through the real wizard by hand, not the CDP-relayed screencast flow `captcha.html` drives.
- [x] **Verified live, after the fix + restart, that the fix is doing something real**: the very next
      live attempt after restarting `node-worker` with the `pollUntil` fix in place produced a
      *different* error than every prior attempt today — `locator.allTextContents: Execution context
      was destroyed, most likely because of a navigation`, thrown from inside the poll loop itself
      (the mid-poll-navigation race the fix's own docblock anticipated, not yet handled at that
      point). Fixed the same way, same-day, same test-first process: `pollUntil` now treats a
      rejected `check()` as "not yet" (`.catch(() => false)`) instead of letting it abort the whole
      poll. One new test (a `check` that rejects with that exact error message on its first call, then
      resolves normally) confirms the poll survives it and still finds the match. 221 tests pass (up
      from 220); `tsc`/`eslint` clean. `node-worker` restarted again to pick this up.
- [ ] **Still open — genuinely blocked now, past the code-level bugs.** The next live attempt after
      *that* restart failed differently again, and worse: `page.goto: net::ERR_CERT_AUTHORITY_INVALID`
      — Chromium itself rejecting the TLS certificate, before any page content loads at all. Three
      distinct, escalating failure shapes across this one session's handful of live attempts
      (`TramiteNotFoundError` → mid-poll navigation error → a TLS handshake rejection) is not
      consistent with "the code has one remaining bug" — it reads as this environment's reputation
      with the site's bot defense degrading progressively *as a direct result of this session's own
      attempts*, now bad enough to be rejected at the TLS layer rather than served a JS challenge at
      all. Deliberately stopped here rather than attempting again immediately: further live attempts
      right now look more likely to worsen this than resolve it. `watch_task_id=3` was paused (not
      resumed) after each verification attempt in this phase, specifically to avoid the scheduler's
      own `everyFiveMinutes()` adding to this without a human deciding to. Real next step, whenever
      resumed: retry after a real recovery window (hours, not minutes) has passed, ideally logging
      whether `ERR_CERT_AUTHORITY_INVALID` recurs before assuming the code fixes above are sufficient
      — this session never got a live run past `selectSede`/`selectTramite` far enough to confirm the
      label fix alone works end-to-end, only that the two race-condition bugs it hit along the way are
      real and now fixed. The manual booking above closes out this specific `WatchTask`'s real-world
      goal, but not this roadmap item: node-worker's own automated flow still hasn't been confirmed,
      live, to get a real trámite/office-scoped check past this point.

## Phase 13 — Found the deeper reason `selectTramite` never found the select at all ⚠️ partially done — see notes

Independent follow-up session, own local stack, own `WatchTask` (`watch_task_id=2` — a different row
from Phase 12's `id=3`, only the source/docs converged via a real `origin/develop` merge mid-session,
not shared runtime state). Started from the same symptom Phase 12 documents (`TramiteNotFoundError`
on a live, real-Redis-driven `recogida de TIE` check) but got there from a still-fresh environment
(no prior live attempts today), which mattered: it reached a stable, fully-loaded page state that
Phase 12's escalating-reputation session never got to hold still long enough to inspect.

- [x] **Confirmed live, via a throwaway recon script (same idiom as Phase 9/12, deleted after the
      run, never committed)**: `selectTramite`'s `page.getByRole("combobox", { name:
      TRAMITE_SELECT_PLACEHOLDER })` matches **zero** elements on the real page — not intermittently,
      not as a timing race `pollUntil` (Phase 12) could ever out-wait, but deterministically, on a
      page confirmed fully settled (a raw `page.locator("select").all()` dump, taken at the exact same
      moment, found all 3 real `<select>`s with real populated `<option>`s, including the target
      trámite label byte-for-byte: `id="tramiteGrupo[0]"`, no associated `<label>` element, so its
      Playwright/Chromium accessible name is empty and `getByRole`'s name-match can never succeed).
      Phase 12's `pollUntil` wrapping made `selectTramite` retry this same always-empty query for up
      to ~10s before giving up — a real improvement for the *different* race it targeted (options
      populating asynchronously), but powerless against a locator that was never going to match
      regardless of how long it waited.
- [x] **Also independently reconfirmed Phase 12's own `sede`-truncation finding**, on this session's
      own `watch_task_id=2`: the real `select#sede` option is `"CNP Benidorm TIE, Callosa
      D\`Ensarria, 2, Benidorm"`, not the short `"CNP Benidorm TIE"` recorded since Phase 9/10 — fixed
      the same way Phase 12 fixed `id=3`, a direct DB write via `tinker`, not a code change (same
      per-`WatchTask` data-quality issue, not something `site-navigator.ts` should special-case).
- [x] **Fixed, test-first**: `selectTramite` no longer uses `getByRole`/an assumed placeholder-name at
      all. New `TRAMITE_SELECT_CSS_SELECTOR = 'select[id^="tramiteGrupo"]'`, matching the real,
      live-confirmed `id` prefix from Phase 9's recon (`tramiteGrupo[0]`/`tramiteGrupo[1]`) — a
      structural DOM hook instead of an accessible-name guess. `TRAMITE_SELECT_PLACEHOLDER` is gone;
      the exact-label-match logic inside the loop (still wrapped in Phase 12's `pollUntil`, since the
      async-population race it fixes is real and orthogonal to this one) is unchanged. Updated
      `site-navigator.test.ts`'s fake `page.locator`/`page.getByRole` to match (the "bot-defense
      reload race" test now overrides `page.locator` instead of `page.getByRole`). No net-new test —
      existing coverage exercises the same code paths through the new locator; 221 tests still pass,
      `tsc`/`eslint` clean.
- [ ] **Still open, same shape as Phase 12's own close-out**: this fix is confirmed only against a
      direct DOM read via the throwaway script, not through a full `runAvailabilityCheck` live run
      that reaches and passes this exact point — today's environment never got a clean enough window
      to attempt that without risking the same reputation-degradation spiral Phase 12 already
      flagged. Whenever a real live attempt resumes (per Phase 12's own guidance — wait for a real
      recovery window, watch for `ERR_CERT_AUTHORITY_INVALID` recurring), this fix is what should
      finally let `selectTramite` succeed where it previously always failed outright.

## Explicit non-goals for this roadmap

- The Laravel-side `event-consumer` service/artisan command — tracked separately in the
  `../application` side, only consumed here as an interface contract (event shapes).
- Anything about `../application` internals beyond the message contract.
