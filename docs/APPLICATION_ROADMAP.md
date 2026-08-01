# application (Laravel) Roadmap

Status: planning. This document sequences the work needed to take `../application` from its
current early scaffold to a complete Laravel side of Cita Watcher, as described in the root
`../CLAUDE.md` and `../application/CLAUDE.md`.

**Already in place** (so later phases don't re-derive it):

- `App\Domain\Notification\...` — `DeliveryStatusEnum`, `NotificationChannelNameEnum`, and value
  objects `NotificationMessage`, `NotificationDeliveryReport`, `DeliveryFailure`, all with unit
  tests.
- `App\Application\Notification\Ports\{NotificationChannelInterface,NotificationChannelResolverInterface}`
  and `UseCases\SendNotificationUseCase` (takes a `NotificationChannelNameEnum` and resolves the
  channel through the resolver port rather than a constructor-fixed channel).
- `App\Infrastructure\Notification\Channels\{MailNotificationChannel,TelegramNotificationChannel}`,
  both implementing the port, with unit tests; `App\Infrastructure\Notification\NotificationChannelResolver`
  implements the resolver port, with unit tests.
- `App\Infrastructure\Providers\NotificationServiceProvider` binds `TelegramNotificationChannel`
  (wired to `services.telegram.bot_token`) and `NotificationChannelResolverInterface` in
  `register()`; covered end-to-end by a Feature test resolving through the container.
- `App\Domain\Watcher\...` — `WatchTask` entity (lifecycle via `start()`/`pause()`/`resume()`/
  `complete()`/`fail()`, guarded by `InvalidWatchTaskTransitionException`); enums
  `WatchTaskStatusEnum` and `WatchTaskNotificationChannelEnum`; value objects `Procedure`,
  `ApplicantData`, `AppointmentSlot`, `CheckResult`; domain events `SlotsFoundEvent`,
  `CaptchaInterventionRequiredEvent`, `CheckFailedEvent`; `WatchTaskRepositoryInterface`. All with
  unit tests. `WatchTaskNotificationChannelEnum` is deliberately its own type, not
  `Domain\Notification\Enums\NotificationChannelNameEnum` — see the Phase 1 note below.
- Phase 0 and Phase 1 (below) are complete.
- Only `User` and the base `Controller` exist outside of the above — no persistence, use cases,
  messaging, or presentation layer for `Watcher` yet.

Every phase below follows the layering and DDD/SOLID conventions in `../application/CLAUDE.md` —
new business capabilities get their own `Domain/<Context>`, `Application/<Context>`,
`Infrastructure/<Context>` subdirectories, dependencies point inward only, and container bindings
live exclusively in `Infrastructure/Providers`.

## Phase 0 — Close out Notification infrastructure ✅ done

- [x] Wire `NotificationServiceProvider::register()`: bind `NotificationChannelInterface` to a
      channel implementation (or introduce a `NotificationChannelResolver`/factory keyed by
      channel name, since both Mail and Telegram implementations already exist and a real
      `WatchTask` will need to pick one per user preference). Implemented as
      `NotificationChannelResolverInterface` → `NotificationChannelResolver`, plus an explicit
      `TelegramNotificationChannel` binding (`MailNotificationChannel` autowires via the framework's
      `Mailer` binding, no explicit binding needed).
- [x] Add `services.telegram.bot_token` (or similar) to `config/services.php`, sourced from
      `env('TELEGRAM_BOT_TOKEN')`, and inject it into `TelegramNotificationChannel` via the
      provider instead of constructing it ad hoc. Also added `TELEGRAM_BOT_TOKEN` to
      `.env.example`.
- [x] Decide how `SendNotificationUseCase` is invoked in practice: it currently takes a single
      injected channel, but a `WatchTask` will need to notify through whichever channel(s) the
      user configured — likely needs a small `NotificationChannelNameEnum` enum/registry rather than
      constructor-fixed channel selection. Done: `NotificationChannelNameEnum` (`mail`/`telegram`)
      added to `Domain/Notification/Enums`; `SendNotificationUseCase::execute()` now takes the enum
      and resolves the channel per call via `NotificationChannelResolverInterface`.
- [x] Feature test exercising the provider bindings end-to-end (container resolves the interface
      to a working channel), not just the channel unit tests that already exist. Added
      `tests/Feature/Notification/NotificationServiceProviderTest.php`.

## Phase 1 — Watcher domain core (`Domain/Watcher`) ✅ done

- [x] `WatchTask` entity: identity, lifecycle status (e.g. `pending` / `running` / `paused` /
      `completed` / `failed`), owning user, notification preferences. Implemented with a private
      mutable `status` behind `start()`/`pause()`/`resume()`/`complete()`/`fail()`; each guards its
      allowed source statuses and throws `InvalidWatchTaskTransitionException` otherwise.
      Constructor rejects a blank `notificationTarget` via `InvalidWatchTaskException`.
- [x] Value objects: `Procedure` (province/trámite combination, validating itself in its
      constructor per the "no anemic domain model" rule), `ApplicantData`, `AppointmentSlot`,
      `CheckResult`. `Procedure`/`ApplicantData` validate required fields aren't blank
      (`InvalidProcedureException`/`InvalidApplicantDataException`); `CheckResult` has no boolean
      "slots found" flag to validate at all — `slotsFound()` is derived from the `slots` array so
      the contradictory state can't be constructed in the first place.
- [x] `WatchTaskStatusEnum` backed enum (mirrors the `DeliveryStatusEnum` pattern already
      established in `Domain/Notification`) — plus `isTerminal()` (`COMPLETED`/`FAILED`).
- [x] Domain events, past-tense per convention: `SlotsFoundEvent`, `CaptchaInterventionRequiredEvent`,
      `CheckFailedEvent` — carrying only the data a listener needs, not whole aggregates.
- [x] `WatchTaskRepositoryInterface` in `Domain/Watcher/Repository` (interface only — no Eloquent
      here). Kept narrow per ISP: `find`/`save`/`delete` only.
- [x] Unit tests for entity/value-object invariants, matching the existing
      `tests/Unit/Domain/Notification/...` structure.

**Design note not in the original checklist:** notification preferences on `WatchTask` use a new
`WatchTaskNotificationChannelEnum` (`Domain/Watcher/Enums`), not
`Domain\Notification\Enums\NotificationChannelNameEnum` directly — reaching into another bounded
context's Domain layer would violate the "Bounded context first" rule in
`../application/CLAUDE.md`. Phase 3's `SlotsFoundEvent` listener is where the two enums get mapped
to each other before calling `SendNotificationUseCase`; don't skip that translation step by having
`WatchTask` depend on the Notification context's enum directly.

## Phase 2 — Watcher persistence (`Infrastructure/Watcher`)

- [ ] Migrations: `watch_tasks`, plus whatever normalization `ApplicantData`/`Procedure` need
      (encrypted columns — see Phase 5).
- [ ] `App\Infrastructure\Persistence\Models\WatchTask` Eloquent model, following the existing
      attribute-based `#[Fillable]`/`#[Hidden]` convention from `Models\User`.
- [ ] `EloquentWatchTaskRepository implements WatchTaskRepositoryInterface` in
      `Infrastructure/Watcher/Persistence`, mapping between the Eloquent model and the Domain
      entity/value objects (Application code must never type-hint the Eloquent class).
- [ ] Bind `WatchTaskRepositoryInterface` → `EloquentWatchTaskRepository` in a new
      `WatcherServiceProvider` (or extend an existing one) registered in `bootstrap/providers.php`.
- [ ] Repository tests against the in-memory SQLite test DB (`phpunit.xml` already configures
      this).

## Phase 3 — Watcher application layer (`Application/Watcher`)

- [ ] Use cases: `CreateWatchTaskUseCase`, `DispatchAvailabilityCheckUseCase` (dispatch only — per
      the SRP example already written into `../application/CLAUDE.md`, it must not also notify or
      log), `PauseWatchTaskUseCase`/`ResumeWatchTaskUseCase`, `DeleteWatchTaskUseCase`.
- [ ] `WorkerGatewayInterface` port (narrow — only knows how to send commands to node-worker, per
      the ISP note in `../application/CLAUDE.md`) in `Application/Watcher/Ports`.
- [ ] Listener(s) reacting to `SlotsFoundEvent` → invoke `SendNotificationUseCase` from Phase 0,
      keeping notification dispatch decoupled from the check-dispatch use case. This is also where
      `WatchTask`'s `WatchTaskNotificationChannelEnum` (Phase 1) gets mapped to Notification's
      `NotificationChannelNameEnum` — the listener is the intended cross-context translation point,
      per the Phase 1 design note above.
- [ ] Unit tests per use case with mocked ports, matching the existing
      `tests/Unit/Application/Notification/SendNotificationUseCaseTest.php` pattern.

## Phase 4 — Outbound command dispatch to node-worker

- [ ] `RedisWorkerGateway implements WorkerGatewayInterface` in `Infrastructure/Watcher/Messaging`,
      publishing to the `watcher-commands` Redis queue that `queue-worker`
      (`php artisan queue:work redis --queue=watcher-commands`) already consumes per
      `docker-compose.yml`.
- [ ] Define the `WorkerCommand` payload shape — must match what `node-worker`'s
      `messaging/` module expects to deserialize (see `../docs/NODE_WORKER_ROADMAP.md` Phase 3;
      coordinate the contract, don't assume it exists yet).
- [ ] Queued job wrapping `DispatchAvailabilityCheckUseCase` (e.g. `DispatchAvailabilityCheckJob`,
      per the `Job` suffix convention in `../application/CLAUDE.md`) so `schedule:work`
      (the `scheduler` service) can enqueue periodic checks per `WatchTask`.
- [ ] Bind `WorkerGatewayInterface` → `RedisWorkerGateway` in `Infrastructure/Providers`.
- [ ] Tests against a fake/real Redis for the gateway; feature test for the scheduled dispatch
      path.

## Phase 5 — Inbound events from node-worker (`event-consumer`)

This is the piece `../CLAUDE.md` explicitly calls out as **not yet implemented** — the
`watcher:consume-events` artisan command is commented out in `docker-compose.yml`.

- [ ] `watcher:consume-events` console command in `Presentation/Console` — thin: subscribe to the
      Redis pub/sub channel(s) node-worker publishes on, deserialize, delegate to a use case.
- [ ] `Application/Watcher/UseCases/HandleCheckCompletedUseCase`,
      `HandleCaptchaRequiredUseCase`, `HandleCheckFailedUseCase` (or one use case dispatching
      Domain events per inbound event type) — each updates `WatchTask` state via the repository
      and raises the corresponding Domain event from Phase 1 for listeners (e.g. notification) to
      react to.
- [ ] Re-enable the `event-consumer` service block in `cita-watcher-docker/docker-compose.yml`
      once the command exists (coordinate with whoever owns docker-compose changes — this file is
      shared infrastructure, not application-only).
- [ ] Tests: fake Redis pub/sub, verify each event type updates `WatchTask` state and triggers the
      right Domain event.

## Phase 6 — Applicant data protection

- [ ] `ApplicantDataEncryptorInterface` port (mentioned as a port example in
      `../application/CLAUDE.md` but not yet created) in `Application/Watcher/Ports`.
- [ ] Infrastructure implementation using Laravel's encryption (`APP_KEY`) or a dedicated envelope
      scheme if applicant data needs independent key rotation from the rest of the app.
- [ ] Ensure `ApplicantData` value object never round-trips through logs/exceptions in plaintext —
      check `DeliveryFailure`/exception messages in the notification channels don't leak it either.
- [ ] Tests: encrypt/decrypt round-trip, and a check that plaintext applicant data never appears
      in `storage/logs/laravel.log` during a normal run.

## Phase 7 — Presentation layer

- [ ] HTTP controllers under `Presentation/Http/Controllers` for `WatchTask` CRUD (create/pause/
      resume/delete), calling Phase 3 use cases only — no business logic in controllers.
- [ ] Form requests / validation for `Procedure` and `ApplicantData` input.
- [ ] Auth: confirm whether `WatchTask` ownership ties to the existing `User` model or needs its
      own actor concept; wire route middleware accordingly.
- [ ] API/feature tests per endpoint using the existing `tests/Feature` structure.

## Phase 8 — Hardening & observability

- [ ] Structured logging correlated by `WatchTask` id / command id, mirroring the correlation
      approach `../docs/NODE_WORKER_ROADMAP.md` Phase 5 plans on the node-worker side.
- [ ] Retry/backoff policy for `CheckFailedEvent` handling — decide what "retryable" means at the
      `WatchTask` level (note `DeliveryStatusEnum::isRetryable()` already models this pattern for
      notifications; reuse the shape for check failures).
- [ ] Rate limiting / concurrency guard so the number of in-flight `WatchTask` checks doesn't
      exceed node-worker's `maxConcurrentSessions`.
- [ ] `composer test` and `./vendor/bin/pint --test` clean across the whole phase's new code.

## Phase 9 — Integration verification

- [ ] End-to-end dry run through `docker compose -f cita-watcher-docker/docker-compose.yml up -d`:
      create a `WatchTask` via HTTP → `queue-worker` dispatches to node-worker → `event-consumer`
      receives the result → notification is sent.
- [ ] Manual captcha-solving walkthrough confirming a `CaptchaRequired` event correctly surfaces
      to whatever UI/notification path is meant to alert a human (scope TBD — not yet designed).

## Explicit non-goals for this roadmap

- `node-worker` internals — tracked in `../docs/NODE_WORKER_ROADMAP.md`, only consumed here as an
  interface/message contract.
- Docker/nginx/compose changes beyond the single `event-consumer` re-enable noted in Phase 5 —
  tracked under `cita-watcher-docker/CLAUDE.md`.
- Any frontend/UI work for viewing the captcha screencast — out of scope for the Laravel side
  itself beyond exposing whatever the WebSocket relay needs from `app`/`nginx`.
