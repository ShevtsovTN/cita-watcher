# CLAUDE.md — cita-watcher-docker/

This file provides guidance to Claude Code when working on the Docker/Compose setup in this
directory. See the repo-root `CLAUDE.md` for the overall monorepo/cross-service picture.

## What this is

Dockerfiles, nginx config, and the `docker-compose.yml` that wires together the Laravel app, the
node-worker, and their supporting services for local/dev/prod runs.

**Project stage:** the `event-consumer` service now runs `php artisan watcher:consume-events`
(Laravel-side implementation is done — see `../docs/APPLICATION_ROADMAP.md` Phase 5). node-worker's
`messaging/` module, its `index.ts` wiring, and its hardening (Phases 3-5 of
`../docs/NODE_WORKER_ROADMAP.md`) are all done now, so `node-worker` is an actual running process
that consumes `watcher-commands` and publishes onto `watcher-events` for real — confirmed live via
a real end-to-end dry run (2026-08-05, `../docs/PHASE9_DRY_RUN.md`). That same dry run also caught
a real reliability bug in this stack, worth knowing about if `event-consumer` ever looks like it's
restarting a lot: it had been silently crash-looping (`RestartCount` in the dozens) on
`RedisException: read error on connection to redis:6379` — `Redis::subscribe()`'s one sustained
blocking read was hitting PHP's 60s default socket timeout on an idle `watcher-events` channel,
since `application/config/database.php`'s `redis.default` connection never set its own
`read_timeout`. `queue-worker` never hit this because Laravel's redis queue driver polls with its
own bounded `BLPOP` internally. Fixed on the `application/` side (`read_timeout` now `-1`), not in
this directory — noted here because it's exactly the kind of thing that looks like a
`docker-compose.yml`/infra problem (a container stuck restarting) but isn't one. A previously-inert
bug in this directory's own `nginx/default.conf` was found and fixed since then, too: a trailing
slash on `location /captcha-ws/`'s `proxy_pass` was stripping the matched prefix before forwarding,
so node-worker would have received `/<token>` instead of `/captcha-ws/<token>` and rejected every
connection — see `../docs/NODE_WORKER_ROADMAP.md` Phase 7. `node-worker`'s `/captcha-ws/` relay now
has a real caller and a real page pointing at it (`application/public/captcha.html`, a static page
nginx serves as part of Laravel's `public/` with no config changes needed — see
`../docs/APPLICATION_ROADMAP.md` Phase 11), but the manual captcha-solving walkthrough itself is
still open: nobody has driven a real captcha through it end-to-end yet, since doing so for real
means attempting an actual reservation on the live site.
The `node-worker` service also has a `healthcheck:` block (Phase 5) — same pattern as `db`/`redis`'s
own `healthcheck:`, just polling a plain HTTP endpoint (`HEALTH_PORT`, default `4002`) via `node -e`
instead of `pg_isready`/`redis-cli ping`, since neither is available on the Playwright base image.

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
  Both are prefixed by Laravel's redis client config (`config('database.redis.options.prefix')`,
  default `Str::slug(APP_NAME)-database-`) — with this repo's default `application/.env` the real
  key/channel names are `laravel-database-watcher-commands`/`laravel-database-watcher-events`, not
  the bare `watcher-commands`/`watcher-events` names used elsewhere as shorthand. Confirmed via
  `redis-cli PUBSUB CHANNELS` — see `../docs/PHASE9_DRY_RUN.md`.
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

**After changing a service's `command:` or `environment:` in `docker-compose.yml`, re-run `up -d`,
not `restart`.** `restart` reuses a container's original startup config and silently does *not*
pick up compose-file changes — `event-consumer` ran as bare `php-fpm` instead of
`watcher:consume-events` for an entire roadmap phase because of exactly this (see
`../docs/PHASE9_DRY_RUN.md`). `up -d` recreates only the containers whose effective config
actually changed.

## Mounts and users

`app`, `queue-worker`, `event-consumer`, and `scheduler` all bind-mount `../application`, so code
changes are picked up without a rebuild; `node-worker` bind-mounts `../node-worker` with a named
volume over `node_modules` so the container's installed deps aren't shadowed by the host mount.
The node-worker container needs `shm_size: 1gb` because headless Chromium requires it.

`app`/`queue-worker`/`event-consumer`/`scheduler` run as `${DOCKER_UID}:${DOCKER_GID}` (set in
`cita-watcher-docker/.env`, default `1000:1000`) rather than the image's built-in `www-data`, so
that bind-mounted `storage/`/`bootstrap/cache` stay writable by whichever host user owns those
files.