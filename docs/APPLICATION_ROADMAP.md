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
  `create_watch_tasks_table` — `Procedure` columns (`province`/`tramite_code`) are plain;
  `ApplicantData` is encrypted at rest as a single `applicant_data` ciphertext column (Phase 6, see
  its notes below) — `EloquentWatchTaskRepository` never sees plaintext `ApplicantData` pass through
  Eloquent. Covered by `tests/Unit/Infrastructure/Watcher/Persistence/EloquentWatchTaskRepositoryTest.php`.
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
- `App\Domain\Watcher\WatchTask::recheck()` (RUNNING → PENDING),
  `App\Application\Watcher\Ports\DomainEventDispatcherInterface` →
  `App\Infrastructure\Watcher\Events\IlluminateDomainEventDispatcher`,
  `App\Application\Watcher\UseCases\{HandleCheckCompletedUseCase,HandleCaptchaRequiredUseCase,HandleCheckFailedUseCase}`,
  `App\Application\Watcher\Listeners\SendNotificationOnCheckFailedListener`,
  `App\Infrastructure\Watcher\Messaging\WorkerEventRouter`, and
  `App\Presentation\Console\Commands\ConsumeWatcherEventsCommand` (`watcher:consume-events`,
  re-enabled in `docker-compose.yml`). All with tests — see the Phase 5 notes below.
- `App\Application\Watcher\Ports\ApplicantDataEncryptorInterface` →
  `App\Infrastructure\Watcher\Encryption\LaravelApplicantDataEncryptor` (wraps
  `Illuminate\Contracts\Encryption\Encrypter`, `APP_KEY`-backed), called from
  `EloquentWatchTaskRepository` on every `save()`/`find()`/`findPending()`. `watch_tasks.applicant_data`
  is a single ciphertext column — see the Phase 6 notes below.
- `App\Presentation\Http\Controllers\WatchTaskController` (index/show/store/pause/resume/destroy)
  under `routes/api.php`, protected by Sanctum (`laravel/sanctum`, token-only, no login endpoint —
  see the Phase 7 notes below) via `auth:sanctum`. Backed by
  `Application\Watcher\UseCases\{ListWatchTasksUseCase,GetWatchTaskUseCase}` (new;
  `WatchTaskRepositoryInterface::findByUserId()` backs the former) plus the existing
  Create/Pause/Resume/Delete use cases, which now take a `$requestingUserId` and enforce ownership.
  `CreateWatchTaskRequest` validates input; `WatchTaskResource` formats responses (omitting
  `documentId`). Domain exceptions are mapped to HTTP statuses in `bootstrap/app.php`. All with
  tests — see the Phase 7 notes below.
- `WatchTask::retry()` (RUNNING → PENDING, retryable check failures — distinct from `recheck()`),
  `CheckFailedEvent::$retryable`, `WatchTaskRepositoryInterface::countRunning()`, and
  `Application\Watcher\UseCases\FindWatchTasksDueForCheckUseCase` (the `maxConcurrentSessions`
  guard, `services.node_worker.max_concurrent_sessions`). `RedisWorkerGateway`,
  `DispatchAvailabilityCheckJob`, and `ConsumeWatcherEventsCommand` now log with
  `watch_task_id`/`command_id` context; `WorkerCommand` carries a `commandId` UUID. See the Phase 8
  notes below.
- Phase 0 through Phase 8 (below) are complete — only Phase 9 (integration verification) remains.
- `User`, the base `Controller`, `WatchTaskController`, and the Phase 4/5 jobs/console commands are
  the Presentation layer so far.

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

## Phase 5 — Inbound events from node-worker (`event-consumer`) ✅ done

- [x] `watcher:consume-events` console command in `Presentation/Console` — thin: subscribe to the
      Redis pub/sub channel(s) node-worker publishes on, deserialize, delegate to a use case.
      Implemented as `Presentation/Console/Commands/ConsumeWatcherEventsCommand`, subscribing to a
      single `watcher-events` channel and delegating each raw message to
      `Infrastructure/Watcher/Messaging/WorkerEventRouter`.
- [x] `Application/Watcher/UseCases/HandleCheckCompletedUseCase`,
      `HandleCaptchaRequiredUseCase`, `HandleCheckFailedUseCase` (or one use case dispatching
      Domain events per inbound event type) — each updates `WatchTask` state via the repository
      and raises the corresponding Domain event from Phase 1 for listeners (e.g. notification) to
      react to. Implemented as three separate use cases (SRP, matching Phase 3's granularity).
- [x] Re-enable the `event-consumer` service block in `cita-watcher-docker/docker-compose.yml`
      once the command exists (coordinate with whoever owns docker-compose changes — this file is
      shared infrastructure, not application-only). Done — `command: ["php", "artisan", "watcher:consume-events"]`
      is uncommented.
- [x] Tests: fake Redis pub/sub, verify each event type updates `WatchTask` state and triggers the
      right Domain event. See the testing-strategy note below for what's actually covered vs. what
      can't be.

**Changes not in the original checklist:**
- **New `WatchTask::recheck()` transition (RUNNING → PENDING)**, added to the Phase 1 entity. The
  existing lifecycle had no way to express "checked, no slots yet, keep watching" — `complete()`
  and `fail()` are both terminal. `HandleCheckCompletedUseCase` calls `complete()` only when
  `CheckResult::slotsFound()` is true; otherwise it calls `recheck()`, so the WatchTask becomes
  `PENDING` again and `DispatchDueAvailabilityChecksCommand` (Phase 4) picks it up on its next
  `everyFiveMinutes()` tick. `recheck()` is deliberately a separate method from `resume()` — the
  latter is a user-driven un-pause action, not "a check finished, poll again."
- **New `Application/Watcher/Ports/DomainEventDispatcherInterface`** (`dispatch(object $event): void`),
  implemented by `Infrastructure/Watcher/Events/IlluminateDomainEventDispatcher` (wraps
  `Illuminate\Contracts\Events\Dispatcher`), bound in `WatcherServiceProvider`. Not called out in
  the checklist, but needed so the three new use cases can raise Domain events without an
  Application-layer class depending on an Illuminate facade directly (per the facade rule in
  `../application/CLAUDE.md`).
- **Single `watcher-events` Redis pub/sub channel with a `type` discriminator field**, symmetric
  with Phase 4's outbound `WorkerCommand` shape, rather than one channel per event type. Payload
  shapes (provisional, not yet confirmed against node-worker's Phase 3 messaging module, which
  doesn't exist yet — see `../docs/NODE_WORKER_ROADMAP.md`):
  - `{"type": "check_completed", "watchTaskId": int, "slots": [{"dateTime": str, "office": str}, ...], "checkedAt": str}`
  - `{"type": "captcha_required", "watchTaskId": int, "occurredAt": str}`
  - `{"type": "check_failed", "watchTaskId": int, "reason": str, "occurredAt": str}`
  `Infrastructure/Watcher/Messaging/WorkerEventRouter` decodes the JSON and routes by `type` to the
  matching Handle*UseCase — the inbound counterpart to `WorkerCommand`.
- **`HandleCaptchaRequiredUseCase` doesn't change `WatchTask` status** — it stays `RUNNING`. The
  manual captcha-solving UX (via the CDP screencast relay) isn't designed yet (Phase 9 still marks
  it "scope TBD"), so this use case only validates the `WatchTask` exists and raises
  `CaptchaInterventionRequiredEvent`; there's deliberately no new status for "awaiting captcha."
- **Only `CheckFailedEvent` gets a new notification listener** (`SendNotificationOnCheckFailedListener`,
  registered in `WatcherServiceProvider::boot()`) — a user should know their watch stopped.
  `CaptchaInterventionRequiredEvent` intentionally has no listener yet, for the same Phase
  9-not-designed reason above; adding one now would mean guessing at a UX that doesn't exist.
- **Testing-strategy limitation, by design:** `ConsumeWatcherEventsCommand::handle()` blocks forever
  inside `Redis::subscribe()` (same shape as `queue:work`), so it isn't and can't be driven by a
  test. All the actual logic — JSON decoding, routing by `type`, use-case dispatch, `WatchTask`
  state transitions, Domain event raising — lives in `WorkerEventRouter` and the three use cases,
  which are fully covered: unit tests per use case (mocked repository/dispatcher, matching the
  Phase 3 pattern) plus `WorkerEventRouterIntegrationTest` (Feature test, real repository/DB,
  `Event::fake()`) exercising all three event types end-to-end. Only the outermost `subscribe()`
  wiring itself goes untested, same as Laravel's own `queue:work` loop.

## Phase 6 — Applicant data protection ✅ done

- [x] `ApplicantDataEncryptorInterface` port (mentioned as a port example in
      `../application/CLAUDE.md` but not yet created) in `Application/Watcher/Ports`. Narrow:
      `encrypt(ApplicantData): string` / `decrypt(string): ApplicantData`.
- [x] Infrastructure implementation using Laravel's encryption (`APP_KEY`) or a dedicated envelope
      scheme if applicant data needs independent key rotation from the rest of the app. Went with
      Laravel's own `APP_KEY`-backed `Illuminate\Contracts\Encryption\Encrypter` — no KMS/secrets
      infra exists anywhere else in this repo, and the port fully isolates this choice, so switching
      to an envelope scheme later needs no Domain/Application changes.
- [x] Ensure `ApplicantData` value object never round-trips through logs/exceptions in plaintext —
      check `DeliveryFailure`/exception messages in the notification channels don't leak it either.
      Verified (and now regression-tested) that `SendNotificationOnSlotsFoundListener`/
      `SendNotificationOnCheckFailedListener` never format applicant fields into a
      `NotificationMessage`; `WorkerEventRouter`'s inbound payloads and `DispatchAvailabilityCheckJob`'s
      serialized payload never carry `ApplicantData` either, so `failed_jobs` and
      `ConsumeWatcherEventsCommand`'s error log stay clean by construction.
- [x] Tests: encrypt/decrypt round-trip, and a check that plaintext applicant data never appears
      in `storage/logs/laravel.log` during a normal run. `LaravelApplicantDataEncryptorTest` covers
      the round-trip (including nullable `phone`); `ApplicantDataDoesNotLeakToLogsTest` points a
      real `single`-driver log channel at a throwaway file and asserts the actual file contents
      never contain the plaintext fields, rather than mocking the logger (no `Log::fake()` exists in
      this Laravel version, and a full Mockery spy can't easily assert "no PII in any call, whatever
      it turns out to be").

**Changes not in the original checklist:**
- **Whole-VO ciphertext, not per-field encryption.** `watch_tasks` had 4 plaintext columns
  (`applicant_full_name`/`applicant_document_id`/`applicant_email`/`applicant_phone`); these are now
  a single `applicant_data` `text` column holding one ciphertext blob of the whole `ApplicantData`
  VO (PHP-serialized then encrypted, via `Encrypter::encrypt()`'s own `$serialize` step — no manual
  JSON needed). `ApplicantData` is already treated as one indivisible value object everywhere else
  in the codebase; encrypting it field-by-field would just be more code for no real security benefit
  (Laravel's encrypter uses a random IV per call regardless).
- **`2026_08_01_120000_create_watch_tasks_table.php` was edited in place**, not superseded by a new
  migration — the table was created in this same not-yet-shipped branch with an explicit "plain for
  now" comment and holds no real data anywhere. Also fixed that comment, which had drifted to
  reference the wrong phase number ("see Phase 5") after Phase 5's scope changed from encryption to
  inbound events.
- **`ConsumeWatcherEventsCommand` refactored**: the `Redis::subscribe()` callback body moved into a
  public `handleMessage(string $payload, WorkerEventRouter $router): void` method. Not encryption
  work per se, but required to write `ApplicantDataDoesNotLeakToLogsTest` at all — `handle()` itself
  blocks forever inside `subscribe()` and can't be driven by a test, so the testable unit had to be
  pulled out. Also dropped the redundant `$this->error(...)` console echo on failure (would have
  required a fully-initialized console `$output`, which a directly-resolved command instance doesn't
  have in a test); `Log::error(...)` alone is the durable record.
- **Scope boundary reaffirmed, not re-litigated:** `RedisWorkerGateway`'s `WorkerCommand` (Phase 4)
  still sends `ApplicantData` in plaintext into the `watcher-commands` Redis list — node-worker
  needs the real name/DNI/email to fill the government form. That's in-flight operational data, not
  "logs," and stays out of Phase 6's scope per the Phase 4 notes.

## Phase 7 — Presentation layer ✅ done

- [x] HTTP controllers under `Presentation/Http/Controllers` for `WatchTask` CRUD (create/pause/
      resume/delete), calling Phase 3 use cases only — no business logic in controllers.
      Implemented as `WatchTaskController` (index/show/store/pause/resume/destroy) — `index`/`show`
      needed their own new use cases, see notes below.
- [x] Form requests / validation for `Procedure` and `ApplicantData` input. `CreateWatchTaskRequest`
      validates `province`/`tramiteCode`/`fullName`/`documentId`/`email`/`phone`/
      `notificationChannel`/`notificationTarget` (camelCase, matching the Phase 4/5 Redis wire
      contracts' naming convention).
- [x] Auth: confirm whether `WatchTask` ownership ties to the existing `User` model or needs its
      own actor concept; wire route middleware accordingly. Ownership ties to `User` (already true
      since Phase 1 — `WatchTask::userId`). The actual open question was how requests authenticate
      at all, since no login/registration flow existed anywhere in the app — see notes below.
- [x] API/feature tests per endpoint using the existing `tests/Feature` structure.
      `WatchTaskControllerTest` covers all six actions plus ownership/transition/validation error
      paths and the unauthenticated case.

**Changes not in the original checklist:**
- **Auth mechanism: Laravel Sanctum, token-only, no login/registration endpoint.** Installed
  `laravel/sanctum`, added `HasApiTokens` to `User`, protected `routes/api.php` with
  `auth:sanctum`. No `POST /login` exists — this app has no self-service signup anywhere, so a
  `User` and their token are created operationally (`php artisan tinker` /
  `$user->createToken(...)->plainTextToken`), not through an HTTP flow. Tests use Sanctum's
  `Sanctum::actingAs()` helper, which doesn't need a real token either. Revisit if this ever needs
  more than a small, operator-managed set of users.
- **`PauseWatchTaskUseCase`/`ResumeWatchTaskUseCase`/`DeleteWatchTaskUseCase` signatures changed**
  from `execute(int $watchTaskId)` to `execute(int $watchTaskId, int $requestingUserId)`. None of
  them checked ownership before this phase — once exposed over HTTP that's a real IDOR (any
  authenticated user could pause/resume/delete any other user's `WatchTask` by guessing an id).
  A mismatch throws the same `WatchTaskNotFoundException` as a missing id (mapped to 404, not a
  separate 403/`Forbidden` exception) — deliberately, so a request can't distinguish "id doesn't
  exist" from "id belongs to someone else."
- **Two new use cases not in the checklist**: `ListWatchTasksUseCase` (`execute(int $requestingUserId): array`,
  backs `index`) and `GetWatchTaskUseCase` (ownership-checked single lookup, backs `show`). The
  checklist's "CRUD (create/pause/resume/delete)" didn't list read endpoints at all, but a watcher
  app with no way to see your own watch tasks isn't usable — added `WatchTaskRepositoryInterface::findByUserId()`
  to back `ListWatchTasksUseCase`. Every controller action goes through a use case, including
  reads — none call the repository directly, keeping the "no business logic in controllers" rule
  from applying inconsistently to writes vs. reads.
- **`WatchTaskResource` omits `documentId`** from every JSON response (`fullName`/`email`/`phone`
  are still included). Phase 6 just finished encrypting `ApplicantData` at rest specifically
  because it's sensitive; echoing the DNI/NIE back on every create/pause/resume/show response would
  undercut that for no real benefit (the caller already knows their own document id).
- **Domain exception → HTTP status mapping centralized in `bootstrap/app.php`'s `withExceptions()`**,
  not in controllers: `WatchTaskNotFoundException` → 404, `InvalidWatchTaskTransitionException` →
  409 (e.g. pausing an already-`COMPLETED`/`FAILED` task), `InvalidProcedureException`/
  `InvalidApplicantDataException`/`InvalidWatchTaskException` → 422. Registered as individual
  `$exceptions->render()` closures rather than one closure for a shared parent type, since
  `Illuminate\Foundation\Exceptions\Handler::renderViaCallbacks()` matches callbacks in
  registration order — a shared-parent catch-all registered before the specific ones would shadow
  them.
- **`routes/api.php` needed adding to `bootstrap/app.php`'s `withRouting()`** — only `web` and
  `commands` were registered before this phase; there was no API route file at all.

## Phase 8 — Hardening & observability ✅ done

- [x] Structured logging correlated by `WatchTask` id / command id, mirroring the correlation
      approach `../docs/NODE_WORKER_ROADMAP.md` Phase 5 plans on the node-worker side.
      `RedisWorkerGateway` logs `watch_task_id`/`command_id` context on dispatch;
      `DispatchAvailabilityCheckJob` seeds `watch_task_id` context before invoking the use case;
      `ConsumeWatcherEventsCommand::handleMessage()` reads `watchTaskId`/`commandId` (if present)
      off the raw inbound payload and attaches them as context before routing. See the notes below
      for why `commandId` is log-correlation only, not a verified round-trip.
- [x] Retry/backoff policy for `CheckFailedEvent` handling — decide what "retryable" means at the
      `WatchTask` level (note `DeliveryStatusEnum::isRetryable()` already models this pattern for
      notifications; reuse the shape for check failures). node-worker decides and sends a
      `retryable: bool` field on the `check_failed` event; `HandleCheckFailedUseCase` calls the new
      `WatchTask::retry()` (RUNNING → PENDING) when retryable, `WatchTask::fail()` (terminal)
      otherwise. `SendNotificationOnCheckFailedListener` skips retryable failures — see notes below.
- [x] Rate limiting / concurrency guard so the number of in-flight `WatchTask` checks doesn't
      exceed node-worker's `maxConcurrentSessions`. New
      `Application\Watcher\UseCases\FindWatchTasksDueForCheckUseCase` caps `findPending()` to
      `max(0, maxConcurrentSessions - countRunning())`; `DispatchDueAvailabilityChecksCommand` now
      calls it instead of `findPending()` directly. `maxConcurrentSessions` comes from
      `services.node_worker.max_concurrent_sessions` (`NODE_WORKER_MAX_CONCURRENT_SESSIONS`,
      default 3 — must be kept in sync by hand with node-worker's own `MAX_CONCURRENT_SESSIONS`,
      since the two run off separate `.env` files with no shared source of truth).
- [x] `composer test` and `./vendor/bin/pint --test` clean across the whole phase's new code. 143
      tests passing; `pint` clean.

**Changes not in the original checklist:**
- **New `WatchTask::retry()` transition**, structurally identical to `recheck()` (RUNNING →
  PENDING) but named separately on purpose — same reasoning as Phase 5's `recheck()` vs. `resume()`
  split: the domain *reason* differs ("the attempt itself failed" vs. "the attempt succeeded and
  found nothing"), and that distinction is worth a name even though the transition is a one-liner.
- **`CheckFailedEvent` gained a `retryable: bool` field**, and `HandleCheckFailedUseCase`'s
  signature changed to `execute(int $watchTaskId, string $reason, bool $retryable, DateTimeImmutable $occurredAt)`.
  `CheckFailedEvent` is still raised on every failure, retryable or not — it's
  `SendNotificationOnCheckFailedListener` that decides whether a retryable (soon-to-retry) failure
  is worth notifying about, not the use case. This keeps the "raise the event, let listeners decide
  what to do" shape from Phase 5 intact rather than branching notification logic into the use case.
- **New `WatchTaskRepositoryInterface::countRunning()`** — the concurrency guard's only new query
  need; `FindWatchTasksDueForCheckUseCase` is the sole caller.
- **`RedisWorkerGateway` and `DispatchAvailabilityCheckJob` now inject `Illuminate\Log\LogManager`**
  via the constructor/`handle()` rather than using the `Log` facade, unlike
  `ConsumeWatcherEventsCommand` (which keeps the facade, since Presentation-layer facade use was
  already established in Phase 5). `RedisWorkerGatewayTest` is a pure `PHPUnit\TestCase` with no
  Laravel bootstrap (consistent with the rest of `Infrastructure/Watcher/Messaging`'s unit tests) —
  the static facade would have needed a booted container just for this one call, so the DI-injected
  `LogManager` (mockable like `RedisFactory`/`Encrypter` already are elsewhere in this layer) was
  the smaller, more consistent change.
- **`WorkerCommand` gained a `commandId` (UUID, via `Str::uuid()`)** — generated fresh per command,
  logged for correlation, never persisted or matched against anything on the way back in. A real
  round-trip verification (rejecting a stale/duplicate response, tracking "last dispatched command
  id" on `WatchTask`) would be a materially bigger change and wasn't what this checklist line asked
  for; revisit if node-worker's eventual messaging module makes staleness a real problem.
- **Inbound event payloads may now carry an optional `commandId`**, read defensively
  (`$data['commandId'] ?? null`) in `ConsumeWatcherEventsCommand::handleMessage()` — not required,
  since node-worker's messaging module (`../docs/NODE_WORKER_ROADMAP.md` Phase 3) still doesn't
  exist to confirm it'll actually send one back.

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
