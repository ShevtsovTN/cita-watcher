# CLAUDE.md — cita-watcher-docker/

This file provides guidance to Claude Code when working on the Docker/Compose setup in this
directory. See the repo-root `CLAUDE.md` for the overall monorepo/cross-service picture.

## What this is

Dockerfiles, nginx config, and the `docker-compose.yml` that wires together the Laravel app, the
node-worker, and their supporting services for local/dev/prod runs.

**Project stage:** the `event-consumer` service now runs `php artisan watcher:consume-events`
(Laravel-side implementation is done — see `../docs/APPLICATION_ROADMAP.md` Phase 5). node-worker
doesn't publish to the `watcher-events` channel it subscribes to yet — its `messaging/` module is
still Phase 3 of `../docs/NODE_WORKER_ROADMAP.md` — so the consumer runs but has nothing to consume
in practice until that lands.

## Service wiring

Read the header comment in `docker-compose.yml` first — it's the authoritative description of how
the services talk to each other. Summary:

- **nginx** serves Laravel's `public/` and reverse-proxies `/captcha-ws/` (WebSocket) straight to
  `node-worker:4001`. The node-worker validates a session token embedded in the path itself and
  binds the connection to the right CDP/Chromium session — nginx does no auth.
- **app** (php-fpm) is the Laravel application.
- **queue-worker** runs `php artisan queue:work redis --queue=watcher-commands` — this is the
  outbound direction: Laravel → node-worker commands.
- **event-consumer** runs `php artisan watcher:consume-events`, subscribing to the single
  `watcher-events` Redis pub/sub channel (`CheckCompleted` / `CaptchaRequired` / `CheckFailed`,
  distinguished by a `type` field) — the inbound direction: node-worker → Laravel.
- **scheduler** runs `php artisan schedule:work`.
- **node-worker** is Playwright + the CDP screencast relay; it owns real browser sessions and does
  the actual site automation.
- **redis** carries both the command queue and the event pub/sub between Laravel and node-worker.
- **db** is Postgres, holding watch tasks, logs, and encrypted applicant data.

## Env files

Two separate `.env` files exist and are not interchangeable:

- `cita-watcher-docker/.env` — variables for docker-compose substitution only (e.g. `DB_PASSWORD`,
  `APP_PORT`, `DOCKER_UID`/`DOCKER_GID`).
- `application/.env` — Laravel's own runtime config, read from the bind-mounted app directory; it
  is deliberately not wired up via compose's `env_file`.

## Common commands

Run from the repo root:

```bash
docker compose -f cita-watcher-docker/docker-compose.yml up -d
```

Requires `cita-watcher-docker/.env` with at least `DB_PASSWORD` set (compose fails fast otherwise).

## Mounts and users

`app`, `queue-worker`, `event-consumer`, and `scheduler` all bind-mount `../application`, so code
changes are picked up without a rebuild; `node-worker` bind-mounts `../node-worker` with a named
volume over `node_modules` so the container's installed deps aren't shadowed by the host mount.
The node-worker container needs `shm_size: 1gb` because headless Chromium requires it.

`app`/`queue-worker`/`event-consumer`/`scheduler` run as `${DOCKER_UID}:${DOCKER_GID}` (set in
`cita-watcher-docker/.env`, default `1000:1000`) rather than the image's built-in `www-data`, so
that bind-mounted `storage/`/`bootstrap/cache` stay writable by whichever host user owns those
files.