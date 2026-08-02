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
exist, plus a committed ESLint flat config and vitest scaffolding with real tests. `src/index.ts` is
still an empty stub — don't assume automation/captcha/messaging logic exists yet (Phases 1–3);
check before referencing it.

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