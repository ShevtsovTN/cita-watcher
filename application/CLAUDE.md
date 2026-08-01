# CLAUDE.md — application/

This file provides guidance to Claude Code when working on the Laravel app in this directory.
See the repo-root `CLAUDE.md` for the overall monorepo/cross-service picture.

## What this is

Laravel 13 (PHP 8.4) app: orchestrates watch tasks, persists state, dispatches commands to the
node-worker, and (eventually) consumes result events back from it.

**Project stage:** early scaffold. Only `User` and the base `Controller`/service provider exist —
don't assume watcher/domain logic exists yet; check before referencing it.

## Architecture principles (apply to all new business logic)

This project follows **Domain-Driven Design** within a **Clean Architecture** layering, and
**SOLID** at the class level. These aren't aspirational — new code is expected to follow them from
the first line, not "cleaned up later." When in doubt, prefer the stricter interpretation below
over the fastest Laravel-idiomatic shortcut.

### Layers and the dependency rule

`Domain` → `Application` → `Infrastructure` / `Presentation`, and dependencies only ever point
**inward**:

- **`App\Domain\<Context>\...`** — entities, value objects, domain events, and repository
  *interfaces*. Zero framework dependencies: no Eloquent, no facades, no `Illuminate\*` imports at
  all. If a Domain class needs `Illuminate\Support\Str` or similar, that's a signal it belongs in
  Infrastructure instead.
- **`App\Application\<Context>\...`** — use cases (application services) and *port* interfaces
  (`WorkerGatewayInterface`, `NotificationChannelInterface`, `ApplicantDataEncryptorInterface`,
  etc.). Use cases orchestrate Domain objects and depend only on interfaces, never on concrete
  Infrastructure classes.
- **`App\Infrastructure\<Context>\...`** — concrete implementations of Application's ports:
  Eloquent repositories, Redis gateways, Telegram/Mail notification channels, encryption codecs.
  This is the only layer allowed to know about Laravel, Eloquent, Redis clients, or third-party
  SDKs.
- **`App\Presentation\...`** — HTTP controllers, console commands, Telegram webhook handlers,
  middleware. Thin: parse input, call a use case, format output. No business logic here.
- **`App\Infrastructure\Providers`** — service providers wiring interfaces to implementations
  (registered in `bootstrap/providers.php`). This is the **only** place `bind()`/`singleton()`
  calls for domain ports should live — don't scatter container bindings across other providers.

A quick self-check before adding a class: *"Which layer's namespace does this go in, and does it
import anything from an outer layer?"* If a `Domain` or `Application` class needs to import
something from `Infrastructure` or a Laravel facade, that's a dependency-rule violation — introduce
a port interface instead and inject the implementation.

### DDD conventions

- **Bounded context first.** New business capabilities get their own subdirectory under each layer
  (e.g. `Domain/Watcher/...`, `Application/Watcher/...`), not a shared dumping-ground namespace.
  Don't reach across contexts directly — go through an explicit port if one context needs
  another's data.
- **Entities vs. value objects.** An entity (e.g. `WatchTask`) has identity and a lifecycle;
  everything else that's fully described by its data (`Procedure`, `ApplicantData`,
  `AppointmentSlot`, `CheckResult`) is a value object: immutable, compared by value, no setters.
  Prefer `final readonly class` for value objects.
- **Repositories are Domain interfaces, Infrastructure implementations.** `WatchTaskRepositoryInterface`
  lives in `Domain/Watcher/Repository`; `EloquentWatchTaskRepository` implements it in
  `Infrastructure/Watcher/Persistence`. Application code type-hints the interface, never the
  Eloquent class.
- **Domain events describe things that happened**, named in the past tense
  (`SlotsFoundEvent`, `CaptchaInterventionRequiredEvent`, `CheckFailedEvent`), and carry only the
  data needed to react to them — not whole aggregates.
- **No anemic domain model.** Business rules and invariants live inside entities/value objects
  (e.g. a `Procedure` value object validates its own province/trámite combination in its
  constructor), not scattered across use cases or controllers as free-floating `if` statements.

### SOLID, concretely for this codebase

- **SRP** — a use case does one thing (`DispatchAvailabilityCheckUseCase` dispatches; it does not
  also notify or persist logs itself — it publishes an event and lets a dedicated listener/use
  case handle notification).
- **OCP** — new notification channels (e.g. adding Slack later) mean a new
  `NotificationChannelInterface` implementation, not an `if ($channel === 'telegram')` branch
  inside an existing use case.
- **LSP** — every `NotificationChannelInterface` implementation must be safely substitutable; don't
  have one implementation throw on inputs another accepts silently.
- **ISP** — keep ports narrow and single-purpose (`WorkerGatewayInterface` only knows how to send
  commands; it doesn't also expose repository-style query methods). Split an interface rather than
  let implementers stub out irrelevant methods.
- **DIP** — Application and Domain depend on interfaces; concrete wiring happens exclusively in
  `Infrastructure/Providers`. Never `new EloquentWatchTaskRepository()` inside a use case —
  constructor-inject `WatchTaskRepositoryInterface`.

### PHP style expected in new code

- `declare(strict_types=1);` at the top of every PHP file.
- Constructor property promotion + `readonly` for value objects and for use case dependencies.
- `final` by default on classes not explicitly designed for extension.
- Prefer backed `enum` over string/int constants for closed sets of values (e.g.
  `CheckResultTypeEnum`, `WatchTaskStatusEnum`) — see "Class naming conventions" below for the
  `Enum` suffix rule.
- Dependency injection via constructor everywhere; avoid `app()`/`resolve()` service-location calls
  and avoid Laravel facades (`Auth::`, `Cache::`, ...) outside the `Presentation`/`Infrastructure`
  layers.
- Match the existing attribute-based model conventions (`#[Fillable]`, `#[Hidden]` — see
  `App\Infrastructure\Persistence\Models\User`) rather than the classic `protected $fillable`
  arrays, for any new Eloquent model.

## Class naming conventions

| Class kind | Rule | Examples |
|---|---|---|
| Domain entity | Plain noun, no suffix | `WatchTask` |
| Value object | Plain noun, no suffix | `NotificationMessage`, `NotificationDeliveryReport`, `DeliveryFailure`, `Procedure`, `ApplicantData` |
| Enum | Suffix `Enum` | `DeliveryStatusEnum`, `NotificationChannelNameEnum`, `WatchTaskStatusEnum` |
| Domain event | Past tense + suffix `Event` | `SlotsFoundEvent`, `CaptchaInterventionRequiredEvent`, `CheckFailedEvent` |
| Repository interface (Domain) | `<Entity>RepositoryInterface` | `WatchTaskRepositoryInterface` |
| Port interface (Application) | Suffix `Interface` | `NotificationChannelInterface`, `NotificationChannelResolverInterface`, `WorkerGatewayInterface`, `ApplicantDataEncryptorInterface` |
| Use case (Application) | Imperative verb phrase + suffix `UseCase` | `SendNotificationUseCase`, `CreateWatchTaskUseCase`, `DispatchAvailabilityCheckUseCase` |
| Listener (Application) | Suffix `Listener` | `SendNotificationOnSlotsFoundListener` |
| Repository implementation (Infrastructure) | `<Adapter><Entity>Repository` | `EloquentWatchTaskRepository` |
| Gateway / resolver / channel implementation (Infrastructure) | `<Adapter><PortNameWithoutInterface>` | `MailNotificationChannel`, `TelegramNotificationChannel`, `NotificationChannelResolver`, `RedisWorkerGateway` |
| Eloquent model (Infrastructure) | Plain noun, no suffix | `User`, `WatchTask` |
| Service provider (Infrastructure) | Suffix `ServiceProvider` | `AppServiceProvider`, `NotificationServiceProvider`, `WatcherServiceProvider` |
| Controller (Presentation) | Suffix `Controller` | `Controller`, `WatchTaskController` |
| Console command (Presentation) | Suffix `Command` | `ConsumeWatcherEventsCommand` |
| Form request (Presentation) | Suffix `Request` | `CreateWatchTaskRequest` |
| Exception | Suffix `Exception` | `UnsupportedNotificationChannelException` |
| Test | `<ClassUnderTest>Test`, mirrors `app/` namespace 1:1 under `tests/Unit`/`tests/Feature` | `SendNotificationUseCaseTest`, `NotificationChannelResolverTest` |

**General rule for Infrastructure port implementations:** name = `<adapter/technology>` +
`<port interface name without the trailing "Interface">`. E.g. `TelegramNotificationChannel` =
`Telegram` + `NotificationChannel` (from `NotificationChannelInterface`); `EloquentWatchTaskRepository`
= `Eloquent` + `WatchTaskRepository` (from `WatchTaskRepositoryInterface`).

## Testing

**Test-first.** For new business logic (Domain, Application, and Infrastructure classes), write
the failing test before the implementation — a unit test for the entity/value-object invariant or
use case, then the code that makes it pass. Don't write production code first and backfill tests
afterward. This applies to bug fixes too: reproduce the bug in a failing test before patching it.

- Match the existing split: `tests/Unit/Domain/<Context>/...`, `tests/Unit/Application/<Context>/...`,
  `tests/Unit/Infrastructure/<Context>/...`, mirroring the `app/` namespace layout 1:1 (see
  `tests/Unit/Domain/Notification/...` and `tests/Unit/Infrastructure/Notification/Channels/...`
  for the pattern to follow).
- `Presentation` controllers/console commands get `tests/Feature` coverage exercising them through
  the framework (HTTP request in, response out), not unit tests that reach into internals.
- A class isn't done when it compiles — it's done when its test (written first) is green.

## Non-standard namespace layout

`application/app/` does **not** use Laravel's default flat namespace. It follows a
layered/hexagonal layout (`App\` → `app/`, per `composer.json` PSR-4), currently:

- `App\Infrastructure\Persistence\Models` — Eloquent models (e.g. `User`).
- `App\Infrastructure\Providers` — service providers (registered in `bootstrap/providers.php`).
- `App\Presentation\Http\Controllers` — controllers.

The docker-compose comments describe the intended full layering as
`Domain/Application/Infrastructure/Presentation`, so expect `App\Domain\...` and
`App\Application\...` namespaces to appear as business logic is added — place new code
accordingly rather than defaulting to Laravel's stock `App\Http\Controllers` / `App\Models`
locations. See "Architecture principles" above for what belongs in each namespace.

The `User` model also uses attribute-based `#[Fillable]` / `#[Hidden]` instead of the classic
`protected $fillable` / `protected $hidden` properties — follow that convention for new models.

## Common commands

```bash
composer install                 # install PHP deps
composer run dev                 # serve + queue:listen + pail (logs) + vite, all concurrently
npm run dev / npm run build      # Vite asset pipeline (Tailwind v4)
```

**Tests and Pint run inside the `app` container, not on the host.** From the repo root:

```bash
docker compose -f cita-watcher-docker/docker-compose.yml exec app composer test
docker compose -f cita-watcher-docker/docker-compose.yml exec app php artisan test --filter=Name
docker compose -f cita-watcher-docker/docker-compose.yml exec app ./vendor/bin/pint
docker compose -f cita-watcher-docker/docker-compose.yml exec app ./vendor/bin/pint --test
```

Never suggest or run `composer test` / `php artisan test` / `./vendor/bin/pint` directly on the
host — the user runs these from inside the container themselves.

Tests run against in-memory SQLite with sync queue/array cache/session drivers regardless of
`application/.env` — see `phpunit.xml`.
