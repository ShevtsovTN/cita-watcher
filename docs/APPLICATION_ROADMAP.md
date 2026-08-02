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
- `App\Infrastructure\Persistence\Models\WatchTask` Eloquent model (native enum casts for
  `status`/`notification_channel`) and `App\Infrastructure\Watcher\Persistence\EloquentWatchTaskRepository`
  implementing `WatchTaskRepositoryInterface`, bound in `WatcherServiceProvider`. Migration
  `create_watch_tasks_table` — `ApplicantData`/`Procedure` columns are plain (not yet encrypted,
  see Phase 6). Covered by `tests/Unit/Infrastructure/Watcher/Persistence/EloquentWatchTaskRepositoryTest.php`.
- `App\Application\Watcher\UseCases\{CreateWatchTaskUseCase,DispatchAvailabilityCheckUseCase,PauseWatchTaskUseCase,ResumeWatchTaskUseCase,DeleteWatchTaskUseCase}`,
  `Application\Watcher\Ports\WorkerGatewayInterface`, and
  `Application\Watcher\Listeners\SendNotificationOnSlotsFoundListener` (registered on
  `SlotsFoundEvent` in `WatcherServiceProvider::boot()`), all with unit tests.
  `WatchTaskNotFoundException` (`Domain\Watcher\Exceptions`) backs the not-found path for the
  id-based use cases — see the Phase 3 note below.
- `App\Infrastructure\Watcher\Messaging\{WorkerCommand,RedisWorkerGateway}` and
  `App\Presentation\Jobs\DispatchAvailabilityCheckJob`, enqueued for every pending `WatchTask` by
  `App\Presentation\Console\Commands\DispatchDueAvailabilityChecksCommand`
  (`watcher:dispatch-due-checks`, scheduled `everyFiveMinutes()` in `routes/console.php`). Bound in
  `WatcherServiceProvider`. All with tests — see the Phase 4 notes below, especially the
  two-different-Redis-keys-with-the-same-name design.
- Phase 0, Phase 1, Phase 2, Phase 3, and Phase 4 (below) are complete.
- Only `User` and the base `Controller` exist as Presentation-layer HTTP pieces (plus the Phase 4
  job/console command above) — no `WatchTask` controllers or the Phase 5 `event-consumer` yet.

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

## Phase 2 — Watcher persistence (`Infrastructure/Watcher`) ✅ done

- [x] Migrations: `watch_tasks`, plus whatever normalization `ApplicantData`/`Procedure` need
      (encrypted columns — see Phase 5). Added `2026_08_01_120000_create_watch_tasks_table.php`
      with plain (unencrypted) columns for now; `user_id` is a `constrained()->cascadeOnDelete()`
      foreign key to `users`.
- [x] `App\Infrastructure\Persistence\Models\WatchTask` Eloquent model, following the existing
      attribute-based `#[Fillable]`/`#[Hidden]` convention from `Models\User`. Also added native
      enum casts (`status` → `WatchTaskStatusEnum`, `notification_channel` →
      `WatchTaskNotificationChannelEnum`) so the repository never handles raw strings.
- [x] `EloquentWatchTaskRepository implements WatchTaskRepositoryInterface` in
      `Infrastructure/Watcher/Persistence`, mapping between the Eloquent model and the Domain
      entity/value objects (Application code must never type-hint the Eloquent class).
- [x] Bind `WatchTaskRepositoryInterface` → `EloquentWatchTaskRepository` in a new
      `WatcherServiceProvider` (or extend an existing one) registered in `bootstrap/providers.php`.
- [x] Repository tests against the in-memory SQLite test DB (`phpunit.xml` already configures
      this). Added `tests/Unit/Infrastructure/Watcher/Persistence/EloquentWatchTaskRepositoryTest.php`
      (create/find/update/delete, `RefreshDatabase`).

**Changes not in the original checklist:**
- `WatchTaskRepositoryInterface::save()` now returns `WatchTask` instead of `void` — a
  not-yet-persisted `WatchTask` has a `null`, `readonly` id, so the caller needs the repository to
  hand back the persisted instance (with the storage-assigned id) rather than mutate the original
  in place.
- Fixed a pre-existing bug uncovered while writing the repository test:
  `database/factories/UserFactory.php` had no explicit `protected $model`, so Laravel's
  convention-based guesser produced `App\User` (the `App\Models\User` guess failed since this repo
  doesn't use that path, and it fell back further than expected) instead of
  `App\Infrastructure\Persistence\Models\User`, which broke `User::factory()->create()` in tests.
  Also fixed `use app\Infrastructure\Persistence\Models\User;` (lowercase `app`) in
  `config/auth.php` and `database/seeders/DatabaseSeeder.php` — same underlying class, wrong case,
  which would have broken real auth/`db:seed` too, not just factories.

## Phase 3 — Watcher application layer (`Application/Watcher`) ✅ done

- [x] Use cases: `CreateWatchTaskUseCase`, `DispatchAvailabilityCheckUseCase` (dispatch only — per
      the SRP example already written into `../application/CLAUDE.md`, it must not also notify or
      log), `PauseWatchTaskUseCase`/`ResumeWatchTaskUseCase`, `DeleteWatchTaskUseCase`.
- [x] `WorkerGatewayInterface` port (narrow — only knows how to send commands to node-worker, per
      the ISP note in `../application/CLAUDE.md`) in `Application/Watcher/Ports`.
- [x] Listener(s) reacting to `SlotsFoundEvent` → invoke `SendNotificationUseCase` from Phase 0,
      keeping notification dispatch decoupled from the check-dispatch use case. This is also where
      `WatchTask`'s `WatchTaskNotificationChannelEnum` (Phase 1) gets mapped to Notification's
      `NotificationChannelNameEnum` — the listener is the intended cross-context translation point,
      per the Phase 1 design note above. Implemented as `SendNotificationOnSlotsFoundListener` in
      `Application/Watcher/Listeners`, registered via `Event::listen()` in
      `WatcherServiceProvider::boot()`.
- [x] Unit tests per use case with mocked ports, matching the existing
      `tests/Unit/Application/Notification/SendNotificationUseCaseTest.php` pattern.

**Changes not in the original checklist:**
- Added `WatchTaskNotFoundException` (`Domain/Watcher/Exceptions`) — not called out in the original
  checklist, but every use case that looks a `WatchTask` up by id (`DispatchAvailabilityCheckUseCase`,
  `PauseWatchTaskUseCase`, `ResumeWatchTaskUseCase`, `DeleteWatchTaskUseCase`) needs a way to signal
  "no such WatchTask" instead of letting a `null` leak past the repository lookup, so it follows the
  existing `Invalid*Exception` static-factory pattern (`WatchTaskNotFoundException::withId()`).
- `DispatchAvailabilityCheckUseCase` also calls `WatchTask::start()` (guarded PENDING → RUNNING
  transition from Phase 1) and re-saves the task after a successful gateway dispatch, so a
  `WatchTask` can't be dispatched twice while a check is already in flight. The gateway call happens
  *before* the state transition/save, so a failed dispatch leaves the persisted `WatchTask` untouched
  rather than stuck showing `RUNNING` with nothing actually sent.
- The `SendNotificationOnSlotsFoundListener` test constructs a real `SendNotificationUseCase` (backed
  by a mocked `NotificationChannelResolverInterface`/`NotificationChannelInterface`) rather than
  mocking `SendNotificationUseCase` directly — it's `final`, and Mockery cannot mock final concrete
  classes.

## Phase 4 — Outbound command dispatch to node-worker ✅ done

- [x] `RedisWorkerGateway implements WorkerGatewayInterface` in `Infrastructure/Watcher/Messaging`,
      publishing to the `watcher-commands` Redis queue that `queue-worker`
      (`php artisan queue:work redis --queue=watcher-commands`) already consumes per
      `docker-compose.yml`.
- [x] Define the `WorkerCommand` payload shape — must match what `node-worker`'s
      `messaging/` module expects to deserialize (see `../docs/NODE_WORKER_ROADMAP.md` Phase 3;
      coordinate the contract, don't assume it exists yet). Implemented as
      `Infrastructure/Watcher/Messaging/WorkerCommand`, a `type`/`watchTaskId`/`procedure`/
      `applicant` shape — not yet confirmed against node-worker since its messaging module doesn't
      exist yet (see note below).
- [x] Queued job wrapping `DispatchAvailabilityCheckUseCase` (e.g. `DispatchAvailabilityCheckJob`,
      per the `Job` suffix convention in `../application/CLAUDE.md`) so `schedule:work`
      (the `scheduler` service) can enqueue periodic checks per `WatchTask`. Implemented as
      `Presentation/Jobs/DispatchAvailabilityCheckJob`, enqueued for every pending `WatchTask` by
      the new `watcher:dispatch-due-checks` command (`Presentation/Console/Commands/DispatchDueAvailabilityChecksCommand`),
      scheduled `everyFiveMinutes()` in `routes/console.php`.
- [x] Bind `WorkerGatewayInterface` → `RedisWorkerGateway` in `Infrastructure/Providers`.
- [x] Tests against a fake/real Redis for the gateway; feature test for the scheduled dispatch
      path. `RedisWorkerGatewayTest` mocks `Illuminate\Contracts\Redis\Factory`/`Connection`;
      `DispatchAvailabilityCheckJobTest` and `DispatchDueAvailabilityChecksCommandTest` cover the
      scheduled path end-to-end through the container (`QUEUE_CONNECTION=sync` in `phpunit.xml`
      runs the job's `handle()` synchronously).

**Changes not in the original checklist:**
- **Two distinct "watcher-commands" channels, by design, not a bug.** `DispatchAvailabilityCheckJob`
  is dispatched onto Laravel's own `watcher-commands` queue (`->onQueue('watcher-commands')` in its
  constructor) so `queue-worker` — the only queue worker `docker-compose.yml` defines — is the
  process that runs it. Its `handle()` then calls `DispatchAvailabilityCheckUseCase`, whose
  `RedisWorkerGateway` does a raw `RPUSH` of the JSON `WorkerCommand` payload onto a *plain* Redis
  list literally named `watcher-commands`. These don't collide: Laravel's redis queue driver always
  stores jobs under a `queues:`-prefixed key (`queues:watcher-commands`), so the raw list
  `RedisWorkerGateway` writes to is a different physical key. This means the literal name
  `watcher-commands` genuinely refers to two different Redis keys depending on which side is
  talking — `queue-worker`'s own Laravel-format job queue, and the raw list node-worker will read
  once its Phase 3 messaging module exists. Don't "fix" this by renaming one of them without
  re-reading this note first.
- Extended `WatchTaskRepositoryInterface` with `findPending(): array` (Phase 1 had deliberately kept
  it to `find`/`save`/`delete` per ISP, but "enqueue periodic checks per `WatchTask`" needs a way to
  enumerate more than one). Only `PENDING` tasks are selected — `RUNNING` ones already have a check
  in flight (guarded by `WatchTask::start()`'s transition rule from Phase 1), and there's currently
  no path back from `RUNNING` to `PENDING` for a re-poll; that transition is Phase 5's concern
  (`HandleCheckCompletedUseCase` deciding "no slots found yet" vs. terminal `COMPLETED`/`FAILED`).
- Artisan commands live under `App\Presentation\Console\Commands` (non-standard namespace, per
  `../application/CLAUDE.md`), which the framework doesn't auto-discover the way it does
  `app/Console/Commands`. `bootstrap/app.php` now calls `->withCommands([app_path('Presentation/Console/Commands')])`
  explicitly — needed for `watcher:dispatch-due-checks` (and any future console command placed
  there) to be registered as an Artisan command at all.
- The `watcher-commands` Redis list name and the Laravel queue name are both hardcoded class
  constants (`RedisWorkerGateway::COMMANDS_LIST`, `DispatchAvailabilityCheckJob::QUEUE`) rather than
  config/env values — unlike `TELEGRAM_BOT_TOKEN` (a real per-environment secret), this name is
  load-bearing infrastructure wiring shared with `docker-compose.yml`'s `queue-worker` command; an
  env override wouldn't be independently useful since compose would also need to change in lockstep.
- Scheduled `everyFiveMinutes()` in `routes/console.php` — not specified by this checklist, chosen
  as a reasonable default polling cadence against a real government site; revisit once Phase 8's
  rate-limiting/concurrency guard exists.

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
