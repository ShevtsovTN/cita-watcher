# CLAUDE.md — node-worker/

This file provides guidance to Claude Code when working on the TypeScript/Playwright worker in
this directory. See the repo-root `CLAUDE.md` for the overall monorepo/cross-service picture.

## What this is

TypeScript + Playwright worker: drives a real browser against
`sede.administracionespublicas.gob.es` and exposes a CDP screencast relay over WebSocket so a
human can solve captchas manually when the automated flow hits one.

**Project stage:** `src/index.ts` is currently an empty stub — don't assume automation/messaging
logic exists yet; check before referencing it.

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
npm run lint          # eslint src --ext .ts (no eslint config committed yet — add one before relying on this)
npm test              # vitest run
```