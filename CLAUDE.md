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
  `APP_PORT`, `DOCKER_UID`/`DOCKER_GID`).
- `application/.env` — Laravel's own runtime config, read from the bind-mounted app directory; it
  is deliberately not wired up via compose's `env_file`.

## Where to look next

- Working on Laravel code (Domain/Application/Infrastructure/Presentation, DDD/SOLID conventions,
  `composer`/`artisan`/`pint` commands)? → `application/CLAUDE.md`.
- Working on the Playwright/CDP worker (TypeScript conventions, `config.ts` pattern, `npm`
  commands)? → `node-worker/CLAUDE.md`.
- Working on Docker Compose, nginx, or service wiring/env files? → `cita-watcher-docker/CLAUDE.md`.