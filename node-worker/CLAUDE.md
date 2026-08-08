# CLAUDE.md — node-worker/

This file provides guidance to Claude Code when working on the TypeScript/Playwright worker in
this directory. See the repo-root `CLAUDE.md` for the overall monorepo/cross-service picture.

## What this is

TypeScript + Playwright worker: drives a real browser against
`sede.administracionespublicas.gob.es` and exposes a CDP screencast relay over WebSocket so a
human can solve captchas manually when the automated flow hits one.

**Project stage:** Phase 0 (`../docs/NODE_WORKER_ROADMAP.md`) is done — `src/types/` (shared domain
types matching the Laravel-side wire contract, split into `commands.ts`/`check-result.ts`/`events.ts`
behind an `index.ts` barrel) and `src/session-token.ts` (`SessionToken`/`generateSessionToken()`)
exist, plus a committed ESLint flat config and vitest scaffolding with real tests. Phase 1 is done:
`src/automation/` has `SessionManager`/`PlaywrightSessionManager` (Playwright browser/session
lifecycle, `maxConcurrentSessions` guard, per-session CDP access for the future captcha relay),
`site-navigator.ts` (`runAvailabilityCheck` — real navigation against
`icp.administracionelectronica.gob.es`, confirmed via live reconnaissance: province → trámite →
either a Cl@ve-only redirect or the manual applicant form, plus WAF-rejection and "Es incorrecto"
validation detection) with its data tables `province-routes.ts`/`country-codes.ts` and
`document-id-validator.ts` (client-side NIE/DNI checksum), and `availability-checker.ts`
(`checkAvailability` — the try/finally session acquire/release wrapper around a check), all behind
the `index.ts` barrel, tested against hand-built fakes of Playwright's
`Browser`/`BrowserContext`/`Page`/`Locator`. Phase 1 closed without ever observing a real
captcha-widget: live recon never got past a sticky WAF block triggered by the applicant-form
submit, so what a *clean* submit actually shows (captcha vs. "no slots" vs. a real slot listing)
is still unconfirmed; see `PostSubmitUnconfirmed` in `site-navigator.ts` and the Phase 1 write-up
in the roadmap — resolving it for real is carried forward into Phase 2, not guessed at here. Also
open:
`src/types/commands.ts`'s `ApplicantData` doesn't have the `documentType`/`birthYear`/`nationality`
fields the real form needs — `site-navigator.ts` uses its own `DocumentIdentity` type for now;
wiring the two together (and the matching Laravel-side change) is Phase 3's job. Phase 2 is done:
`src/captcha/` has the full relay pipeline — `relay-server.ts` (`WsScreencastRelay`, WS server on
`config.cdpRelay.port` that validates the path token's form), `session-registry.ts`/
`session-binder.ts` (`CaptchaSessionRegistry`, maps a token to its `AutomationSession`),
`screencast-frame-relay.ts` (`CdpScreencastFrameRelay`, pipes `Page.startScreencast` frames to the
WS client), and `input-relay.ts` (`CdpInputRelay`, relays mouse/key input back via CDP and signals
`onResolved()` on a client's `resolved` message) — all tested against hand-built fakes of `ws` and
`CDPSession`, same idiom as `automation/`'s Playwright fakes. None of it has run against a real WS
connection or a real captcha yet — `PostSubmitUnconfirmed` from Phase 1 is still unconfirmed; see
the Phase 2 write-up in the roadmap for what's still open (nothing calls
`CaptchaSessionRegistry.register()` yet, and the screencast/input wire contracts are this phase's
own invention pending a real UI). Phase 3 is done: `src/messaging/` has `redis-command-consumer.ts`
(`RedisCommandConsumer`, a backpressure-guarded `BRPOP` loop over `watcher-commands`),
`worker-command-parser.ts` (`parseWorkerCommand`), `redis-event-publisher.ts`
(`RedisEventPublisher`, publishes to `watcher-events`), `outcome-to-event.ts`
(`mapNavigationOutcomeToCheckFailedEvent` — every `NavigationOutcome` still only maps to
`CheckFailedEvent`, since no real captcha or success page has ever been confirmed), and
`command-handler.ts` (`createWorkerCommandHandler`, the glue that actually runs `checkAvailability`
per command and publishes the resulting event) — all behind the `index.ts` barrel, tested against
hand-built fakes plus one real-Redis integration test (`redis-integration.test.ts`, logical DB 15).
Closed a Phase 1 gap in the same increment: `src/types/commands.ts`'s `ApplicantData` now carries
`documentType`/`birthYear`/`nationality`, matching the real applicant form and the Laravel-side
`ApplicantData.php`/`DocumentTypeEnum` — `site-navigator.ts`'s standalone `DocumentIdentity` type is
gone, replaced by `ApplicantData` directly. Phase 4 is done: `src/index.ts` is now the composition
root — constructs a `PlaywrightSessionManager`, two dedicated `ioredis` clients (`BRPOP` blocks its
connection, so it can't share one with `PUBLISH`), wires `RedisCommandConsumer` through
`createWorkerCommandHandler` to `RedisEventPublisher`, and wires `WsScreencastRelay` through
`bindConnectionToRegisteredSession` to a new `relayCaptchaSession()` helper that actually starts
`CdpScreencastFrameRelay`/`CdpInputRelay` for a bound connection. Also handles graceful
SIGTERM/SIGINT shutdown (stop the command consumer, close open WS sockets — `ws`'s own
`WebSocketServer.close()` doesn't do this for you — then the relay/browser/Redis clients, in that
order) and top-level error handling (a `withErrorHandling` wrapper around the command handler, a
`.catch()` on each captcha-relay connection, plus process-level `unhandledRejection`/
`uncaughtException` listeners as a last resort) so one failed command or connection can't crash the
process. No new test file — this phase is a composition root wiring already-tested pieces via real
constructors, verified manually against the live dev stack instead (see the roadmap's Phase 4
write-up for what was checked). `CaptchaSessionRegistry.register()` still has no caller anywhere,
though — no real captcha has ever been observed, so in practice no `/captcha-ws/` connection ever
binds to a session yet, and `CdpInputRelay`'s `resolved` signal has no automation-side pause point
to actually resume (`automation/` doesn't pause mid-check for anything). Both are still open,
carried since Phase 0/2 — not resolved by this wiring, just no longer blocked on it existing.
Phase 5 is done: `src/logger.ts` (`Logger`, a `ConsoleLogger` singleton with `withContext()` —
binds `command_id`/`watch_task_id` once, mirroring Laravel's own `Log::withContext()` field names
so both services' logs are grep-able by the same keys) replaced the plain `console.log`/
`console.error` calls Phase 4 added, wired into `command-handler.ts` (`info` on every published
event, `error` on an unexpected exception — see next), `redis-command-consumer.ts` (`error` when
dropping a malformed payload, previously silent — logs a byte count, never the raw payload, to
avoid an applicant-PII leak), and `index.ts`. `command-handler.ts` now also catches an uncaught
exception from `checkAvailability` and publishes a `retryable: true` `CheckFailedEvent` instead of
letting it propagate and leave the command's `WatchTask` stuck with no event at all — closing the
gap Phase 4's own write-up flagged; `index.ts`'s `withErrorHandling` is now just the last-resort
net for what even that can't catch. A new `src/health-server.ts` (`HttpHealthServer`, same
DI-factory idiom as `captcha/relay-server.ts`) serves `config.health.port`/`HEALTH_PORT` (default
`4002`), answering `200`/`503` from `() => commandRedis.status === "ready" && eventRedis.status ===
"ready"` — backs a new `healthcheck:` block on the `node-worker` compose service. `shm_size: 1gb`
was verified against 3 concurrent real Chromium sessions doing actual rendering work (not just
theorized) — no crash, confirmed sufficient for the current `maxConcurrentSessions` default.
Phase 6 (integration verification) is partially done: a real Laravel-dispatched command being
picked up and resulting in a published event, and a real (unrelated) Redis bug found and fixed
along the way, are both confirmed live — see `../docs/PHASE9_DRY_RUN.md`. Separately, manual
browser recon (2026-08-05, by a human, not node-worker — automated recon was blocked by the dev
network's own intrusion-prevention policy) confirmed a real trámite label, a real ~6-character
alphanumeric captcha (the site's `eu-captcha` widget), and that the real post-identity-form flow is
a 5-step wizard, not the single-shot form `site-navigator.ts` used to assume — full findings in
`../docs/PHASE9_DRY_RUN.md`'s "Manual browser recon" section. As scoped follow-up the same day,
`site-navigator.ts` now models the first three of those five steps (options menu → `acCitar` →
`acOfertarCita`) via a new `CaptchaBlockedSlotsOffered` outcome, and `fillApplicantForm` is now
trámite-aware instead of assuming a fixed field set — see `../docs/NODE_WORKER_ROADMAP.md` Phase 6
for the full write-up. `acVerificarCita`/`acGrabarCita` (steps 4-5) are still unmodeled.

Phase 7 is partially done (node-worker side only — see `../docs/NODE_WORKER_ROADMAP.md` Phase 7):
`availability-checker.ts`'s `checkAvailability` no longer auto-releases the session for a
`captcha_blocked_slots_offered` outcome, `captcha/session-registry.ts`'s `CaptchaSessionRegistry.
register()` has a real production caller for the first time (bridging `index.ts`'s WS relay to
`messaging/command-handler.ts`, which now actually pauses, publishes `CaptchaRequiredEvent{
sessionToken}` promptly, and waits for either `notifyResolved()` or a new configurable timeout
before releasing), and a real, previously-inert `cita-watcher-docker/nginx/default.conf` bug
(a `proxy_pass` trailing slash stripping the `/captcha-ws/` prefix) was found and fixed along the
way. `createWorkerCommandHandler` moved from 5 positional params to a `WorkerCommandHandlerDeps`
options object as part of this. 191 tests pass (up from 179). The Laravel-side half — reading
`sessionToken`, building the `{APP_URL}/captcha-ws/{sessionToken}` link, and a new notification
listener — was deliberately deferred to a separate branch/PR at the time (shipping the node-worker
side alone was safe since nothing on the Laravel side read the new field yet), and **is now done**:
see `../docs/APPLICATION_ROADMAP.md` Phase 10.

Phase 8 is done: `command-handler.ts` used to do nothing after a captcha session's `"resolved"`
signal beyond releasing it — now it does one more thing. The CDP relay
(`captcha/input-relay.ts`) turned out to give a connected human full, unscoped `Input.
dispatchMouseEvent`/`dispatchKeyEvent` control of the whole page, not just a captcha field, so
`"resolved"` means the human presumably already clicked through the rest of the 5-step wizard
themselves (`acVerificarCita`/`acGrabarCita` included) via the screencast UI — node-worker doesn't
need to automate those steps, only classify what state the page ended up in. New
`site-navigator.ts` export `classifyPostResolutionOutcome(page, province)` detects the one
behavior actually confirmed by recon (the site's 5-minute window expiring silently bounces back to
the trámite-entry URL, no error, no reservation) as `ReservationWindowExpired`, reuses
`detectWafRejection`, and falls through to the existing `PostSubmitUnconfirmed` for everything else
— deliberately not guessing at the unconfirmed "Estoy conforme" checkbox, submit button, or any
success screen for what would be a real, irreversible booking action. New
`messaging/outcome-to-event.ts` export `mapPostResolutionOutcomeToCheckFailedEvent` maps all three
cases to `retryable: true`; `CheckCompletedEvent` still isn't published anywhere, unchanged, since
no real `acGrabarCita` success page has ever been observed. 207 tests pass (up from 199). Full
write-up: `../docs/NODE_WORKER_ROADMAP.md` Phase 8. This phase only changed what happens once a
human *has* resolved a session, not whether they had a way to do that in the first place — that
part shipped separately, same week, on the `../application` side (`../docs/APPLICATION_ROADMAP.md`
Phase 11): `application/public/captcha.html`, a static page served directly by nginx, actually
connects to this relay and renders it, so `LaravelCaptchaSessionUrlBuilder`'s link now points
somewhere real instead of at the bare `/captcha-ws/<token>` WebSocket endpoint. The one thing still
open is the live walkthrough itself — a real captcha, solved by a human through that page, has
never actually happened end-to-end (the page was verified against a throwaway mock relay and
against this stack's real 4400/4404 close-code paths, deliberately not against the real site, which
would mean attempting a real reservation).

## Conventions

The same dependency-inversion spirit from the Laravel app applies here even though it isn't
formally layered into Domain/Application/Infrastructure: `automation/`, `captcha/`, and
`messaging/` should depend on each other through interfaces/types they own, not by importing
concrete classes across folders where an abstraction would do.

`tsconfig.json` is deliberately strict (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, etc.) — match that bar in new
code. Module output is CommonJS via `NodeNext` (package.json has no `"type": "module"`), which is
what `CMD ["node", "dist/index.js"]` in the Dockerfile expects.

### Naming conventions

TypeScript idiom here, not the PHP side's `Interface`-suffix style: an interface/type describing a
data shape gets a plain noun name; only concrete classes get a distinguishing prefix when more than
one implementation of a role could exist.

| Kind | Rule | Examples |
|---|---|---|
| Config/data-shape interface | Plain noun, no suffix | `WorkerConfig` |
| Message/domain type (command, result, slot) | Plain noun, no suffix | `WorkerCommand`, `CheckResult`, `AppointmentSlot` |
| Outbound event shape | Suffix `Event`, past-tense/descriptive | `CheckCompletedEvent`, `CaptchaRequiredEvent`, `CheckFailedEvent` |
| Custom error class | Suffix `Error`, extends `Error` | `EnvValidationError` |
| Role interface with pluggable implementations | Plain noun naming the role, no suffix | `SessionManager`, `ScreencastRelay` |
| Concrete implementation of a role interface | `<Technology/detail><RoleName>` | `PlaywrightSessionManager`, `RedisCommandConsumer`, `RedisEventPublisher` |
| Module-level singleton instance | camelCase, mirrors its type name | `config` (instance of `WorkerConfig`) |
| Function | camelCase verb phrase | `loadConfig`, `requireString`, `parsePort` |
| Narrow/internal type alias | PascalCase noun, no suffix | `EnvSource` |
| Test file | `<subject>.test.ts`, colocated or mirroring `src/` under a test root | `config.test.ts` |

**General rule for role-interface implementations:** name = `<technology/detail>` + `<role
interface name>` — the same principle as the PHP side's "adapter + port name" rule, just without
an `Interface` suffix to strip since TS interfaces don't carry one here.

### Config convention (`src/config.ts`)

**Never read `process.env` outside this module.** Everything else depends only on the
`WorkerConfig` interface. Config is parsed and validated once, fails fast via
`EnvValidationError` on bad input, and the result is frozen/immutable. Extend
`loadConfig`/`WorkerConfig` the same way when adding new env-driven settings — this is the model
for "parse and validate all external input once, at the edge, and pass typed/frozen objects
inward."

## Common commands

```bash
npm run dev         # tsx watch src/index.ts — live reload during development
npm run build        # tsc -p tsconfig.json -> dist/
npm run typecheck    # tsc --noEmit
npm run lint          # eslint src (flat config: eslint.config.mjs, typescript-eslint strictTypeChecked)
npm test              # vitest run
```

Run these inside the `node-worker` container (`docker compose -f cita-watcher-docker/docker-compose.yml exec node-worker <cmd>`) so Node/dependency versions match the image, not whatever's on the host.

**Known dev-container gap:** the `node-worker` compose service has no `user:` override (unlike the
PHP services, which run as `${DOCKER_UID}:${DOCKER_GID}`), so commands that write to the
bind-mounted source dir (`npm install`, `npm run build`) fail as the image's fixed `pwuser` —
`EACCES` on `package.json`/`dist/`. Work around per-command with
`docker compose exec -u root node-worker <cmd>`, then `chown` any bind-mounted files it touched
back to the host UID. Not fixed at the compose level — changing node-worker's runtime user risks
breaking Playwright's `pwuser`-relative paths (browser binaries, `$HOME`) and needs real
verification once `automation/` (Phase 1) actually launches a browser, not a speculative change.