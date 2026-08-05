# node-worker Roadmap

Status: Phase 0 through Phase 4 done. `automation/` has `PlaywrightSessionManager`
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
