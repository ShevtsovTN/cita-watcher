# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Cita Watcher automates checking `sede.administracionespublicas.gob.es` (a Spanish government
appointment-booking site) for available appointment slots, and relays a live browser view over
WebSocket so a human can solve captchas manually when the automated flow hits one.

The repo is a monorepo with three independent parts, each with its own toolchain:

- `application/` — Laravel 13 (PHP 8.4) app: orchestrates watch tasks, persists state, dispatches
  commands to the worker, and (eventually) consumes result events.
- `node-worker/` — TypeScript + Playwright worker: drives a real browser against the target site
  and exposes a CDP screencast relay over WebSocket for manual captcha solving.
- `cita-watcher-docker/` — Dockerfiles, nginx config, and the `docker-compose.yml` that wires
  everything together for local/dev/prod runs.

**Project stage:** this is an early scaffold. Only `User` and the base `Controller`/service
provider exist on the Laravel side; `node-worker/src/index.ts` is an empty stub; the
`event-consumer` service and its `watcher:consume-events` artisan command don't exist yet (the
line is commented out in `docker-compose.yml`). Don't assume watcher/domain logic exists — check
before referencing it.

## Cross-service architecture

Read the header comment in `cita-watcher-docker/docker-compose.yml` first — it's the
authoritative description of how the services talk to each other. Summary:

- **nginx** serves Laravel's `public/` and reverse-proxies `/captcha-ws/` (WebSocket) straight to
  `node-worker:4001`. The node-worker validates a session token embedded in the path itself and
  binds the connection to the right CDP/Chromium session — nginx does no auth.
- **app** (php-fpm) is the Laravel application.
- **queue-worker** runs `php artisan queue:work redis --queue=watcher-commands` — this is the
  outbound direction: Laravel → node-worker commands.
- **event-consumer** (not yet implemented) will consume events from the node-worker
  (`CheckCompleted` / `CaptchaRequired` / `CheckFailed`) via Redis pub/sub — the inbound
  direction: node-worker → Laravel.
- **scheduler** runs `php artisan schedule:work`.
- **node-worker** is Playwright + the CDP screencast relay; it owns real browser sessions and does
  the actual site automation.
- **redis** carries both the command queue and the event pub/sub between Laravel and node-worker.
- **db** is Postgres, holding watch tasks, logs, and encrypted applicant data.

Two separate `.env` files exist and are not interchangeable:
- `cita-watcher-docker/.env` — variables for docker-compose substitution only (e.g. `DB_PASSWORD`,
  `APP_PORT`).
- `application/.env` — Laravel's own runtime config, read from the bind-mounted app directory; it
  is deliberately not wired up via compose's `env_file`.

## Laravel app: non-standard namespace layout

`application/app/` does **not** use Laravel's default flat namespace. It follows a
layered/hexagonal layout (`App\` → `app/`, per `composer.json` PSR-4), currently:

- `App\Infrastructure\Persistence\Models` — Eloquent models (e.g. `User`).
- `App\Infrastructure\Providers` — service providers (registered in `bootstrap/providers.php`).
- `App\Presentation\Http\Controllers` — controllers.

The docker-compose comments describe the intended full layering as
`Domain/Application/Infrastructure/Presentation`, so expect `App\Domain\...` and
`App\Application\...` namespaces to appear as business logic is added — place new code
accordingly rather than defaulting to Laravel's stock `App\Http\Controllers` / `App\Models`
locations.

The `User` model also uses attribute-based `#[Fillable]` / `#[Hidden]` instead of the classic
`protected $fillable` / `protected $hidden` properties — follow that convention for new models.

## Common commands

### Laravel app (`application/`)

```bash
composer install                 # install PHP deps
composer run dev                 # serve + queue:listen + pail (logs) + vite, all concurrently
composer test                    # clears config cache, then `php artisan test`
php artisan test --filter=Name   # run a single test (by method/class name)
php artisan test tests/Feature/ExampleTest.php   # run a single test file
./vendor/bin/pint                # code style fixer (Laravel Pint)
./vendor/bin/pint --test         # check style without fixing
npm run dev / npm run build      # Vite asset pipeline (Tailwind v4)
```

Tests run against in-memory SQLite with sync queue/array cache/session drivers regardless of
`application/.env` — see `phpunit.xml`.

### Node worker (`node-worker/`)

```bash
npm run dev         # tsx watch src/index.ts — live reload during development
npm run build        # tsc -p tsconfig.json -> dist/
npm run typecheck    # tsc --noEmit
npm run lint          # eslint src --ext .ts (no eslint config committed yet — add one before relying on this)
npm test              # vitest run
```

`tsconfig.json` is deliberately strict (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, etc.) — match that bar in new
code. Module output is CommonJS via `NodeNext` (package.json has no `"type": "module"`), which is
what `CMD ["node", "dist/index.js"]` in the Dockerfile expects.

Config convention (see `src/config.ts`): **never read `process.env` outside this module.**
Everything else depends only on the `WorkerConfig` interface. Config is parsed and validated once,
fails fast via `EnvValidationError` on bad input, and the result is frozen/immutable. Extend
`loadConfig`/`WorkerConfig` the same way when adding new env-driven settings.

### Docker Compose (run from repo root)

```bash
docker compose -f cita-watcher-docker/docker-compose.yml up -d
```

Requires `cita-watcher-docker/.env` with at least `DB_PASSWORD` set (compose fails fast otherwise).
`app`, `queue-worker`, `event-consumer`, and `scheduler` all bind-mount `../application`, so code
changes are picked up without a rebuild; `node-worker` bind-mounts `../node-worker` with a named
volume over `node_modules` so the container's installed deps aren't shadowed by the host mount.
The node-worker container needs `shm_size: 1gb` because headless Chromium requires it.
