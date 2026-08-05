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
gone, replaced by `ApplicantData` directly. `src/index.ts` is still an empty stub — nothing wires
`automation/`/`captcha/`/`messaging/` together into an actual running process yet (Phase 4); don't
assume that wiring exists, check before referencing it.

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