<?php

declare(strict_types=1);

namespace Tests\Feature\Watcher;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Events\CaptchaInterventionRequiredEvent;
use App\Domain\Watcher\Events\CheckFailedEvent;
use App\Domain\Watcher\Events\SlotsFoundEvent;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Persistence\Models\User;
use App\Infrastructure\Watcher\Messaging\WorkerEventRouter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * Exercises WorkerEventRouter through the real container (real repository, real DB, real
 * Illuminate event dispatcher via Event::fake()) — this is the piece "Tests: fake Redis pub/sub"
 * from the Phase 5 roadmap checklist actually covers, since ConsumeWatcherEventsCommand's
 * Redis::subscribe() loop itself blocks forever and isn't something a test can drive.
 */
final class WorkerEventRouterIntegrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_check_completed_with_slots_completes_the_task_and_dispatches_slots_found(): void
    {
        Event::fake();

        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask());
        $watchTask->start();
        $repository->save($watchTask);

        $router = $this->app->make(WorkerEventRouter::class);

        $router->route(json_encode([
            'type' => 'check_completed',
            'watchTaskId' => $watchTask->id(),
            'slots' => [
                ['dateTime' => '2026-08-10T10:00:00+00:00', 'office' => 'Madrid Office'],
            ],
            'checkedAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));

        $this->assertSame(WatchTaskStatusEnum::COMPLETED, $repository->find($watchTask->id())->status());
        Event::assertDispatched(SlotsFoundEvent::class, fn(SlotsFoundEvent $event): bool => $event->watchTaskId === $watchTask->id());
    }

    public function test_check_completed_without_slots_sends_the_task_back_to_pending(): void
    {
        Event::fake();

        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask());
        $watchTask->start();
        $repository->save($watchTask);

        $router = $this->app->make(WorkerEventRouter::class);

        $router->route(json_encode([
            'type' => 'check_completed',
            'watchTaskId' => $watchTask->id(),
            'slots' => [],
            'checkedAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));

        $this->assertSame(WatchTaskStatusEnum::PENDING, $repository->find($watchTask->id())->status());
        Event::assertNotDispatched(SlotsFoundEvent::class);
    }

    public function test_captcha_required_dispatches_the_domain_event_without_changing_status(): void
    {
        Event::fake();

        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask());
        $watchTask->start();
        $repository->save($watchTask);

        $router = $this->app->make(WorkerEventRouter::class);

        $router->route(json_encode([
            'type' => 'captcha_required',
            'watchTaskId' => $watchTask->id(),
            'occurredAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));

        $this->assertSame(WatchTaskStatusEnum::RUNNING, $repository->find($watchTask->id())->status());
        Event::assertDispatched(CaptchaInterventionRequiredEvent::class, fn(CaptchaInterventionRequiredEvent $event): bool => $event->watchTaskId === $watchTask->id());
    }

    public function test_check_failed_fails_the_task_and_dispatches_check_failed(): void
    {
        Event::fake();

        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask());
        $watchTask->start();
        $repository->save($watchTask);

        $router = $this->app->make(WorkerEventRouter::class);

        $router->route(json_encode([
            'type' => 'check_failed',
            'watchTaskId' => $watchTask->id(),
            'reason' => 'invalid procedure',
            'retryable' => false,
            'occurredAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));

        $this->assertSame(WatchTaskStatusEnum::FAILED, $repository->find($watchTask->id())->status());
        Event::assertDispatched(CheckFailedEvent::class, fn(CheckFailedEvent $event): bool => 'invalid procedure' === $event->reason);
    }

    public function test_a_retryable_check_failed_sends_the_task_back_to_pending(): void
    {
        Event::fake();

        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask());
        $watchTask->start();
        $repository->save($watchTask);

        $router = $this->app->make(WorkerEventRouter::class);

        $router->route(json_encode([
            'type' => 'check_failed',
            'watchTaskId' => $watchTask->id(),
            'reason' => 'navigation timeout',
            'retryable' => true,
            'occurredAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));

        $this->assertSame(WatchTaskStatusEnum::PENDING, $repository->find($watchTask->id())->status());
        Event::assertDispatched(CheckFailedEvent::class, fn(CheckFailedEvent $event): bool => $event->retryable);
    }

    private function makeWatchTask(): WatchTask
    {
        $user = User::factory()->create();

        return new WatchTask(
            id: null,
            userId: $user->id,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com', documentType: DocumentTypeEnum::DNI, birthYear: 1990, nationality: 'España'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
