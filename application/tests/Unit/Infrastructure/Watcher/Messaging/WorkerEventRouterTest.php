<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Watcher\Messaging;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Application\Watcher\Ports\DomainEventDispatcherInterface;
use App\Application\Watcher\UseCases\HandleCaptchaRequiredUseCase;
use App\Application\Watcher\UseCases\HandleCheckCompletedUseCase;
use App\Application\Watcher\UseCases\HandleCheckFailedUseCase;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Events\CaptchaInterventionRequiredEvent;
use App\Domain\Watcher\Events\CheckFailedEvent;
use App\Domain\Watcher\Events\SlotsFoundEvent;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Watcher\Messaging\WorkerEventRouter;
use InvalidArgumentException;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class WorkerEventRouterTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_routes_check_completed_with_slots_to_the_use_case(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->andReturn($watchTask);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldReceive('dispatch')->once()->with(Mockery::type(SlotsFoundEvent::class));

        $router = $this->makeRouter($repository, $dispatcher);

        $router->route(json_encode([
            'type' => 'check_completed',
            'watchTaskId' => 42,
            'slots' => [
                ['dateTime' => '2026-08-10T10:00:00+00:00', 'office' => 'Madrid Office'],
            ],
            'checkedAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));
    }

    public function test_it_routes_check_completed_without_slots_back_to_pending(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->andReturn($watchTask);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldNotReceive('dispatch');

        $router = $this->makeRouter($repository, $dispatcher);

        $router->route(json_encode([
            'type' => 'check_completed',
            'watchTaskId' => 42,
            'slots' => [],
            'checkedAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));
    }

    public function test_it_routes_captcha_required_to_the_use_case(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldReceive('dispatch')
            ->once()
            ->with(Mockery::on(fn(CaptchaInterventionRequiredEvent $event): bool => 'abc123' === $event->sessionToken));

        $router = $this->makeRouter($repository, $dispatcher);

        $router->route(json_encode([
            'type' => 'captcha_required',
            'watchTaskId' => 42,
            'sessionToken' => 'abc123',
            'occurredAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));
    }

    public function test_it_routes_check_failed_to_the_use_case(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->andReturn($watchTask);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldReceive('dispatch')->once()->with(Mockery::type(CheckFailedEvent::class));

        $router = $this->makeRouter($repository, $dispatcher);

        $router->route(json_encode([
            'type' => 'check_failed',
            'watchTaskId' => 42,
            'reason' => 'site unreachable',
            'retryable' => false,
            'occurredAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));
    }

    public function test_it_routes_a_retryable_check_failed_back_to_pending(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->andReturn($watchTask);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldReceive('dispatch')
            ->once()
            ->with(Mockery::on(fn(CheckFailedEvent $event): bool => true === $event->retryable));

        $router = $this->makeRouter($repository, $dispatcher);

        $router->route(json_encode([
            'type' => 'check_failed',
            'watchTaskId' => 42,
            'reason' => 'navigation timeout',
            'retryable' => true,
            'occurredAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR));

        $this->assertSame(WatchTaskStatusEnum::PENDING, $watchTask->status());
    }

    public function test_it_rejects_an_unknown_event_type(): void
    {
        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldNotReceive('dispatch');

        $router = $this->makeRouter($repository, $dispatcher);

        $this->expectException(InvalidArgumentException::class);

        $router->route(json_encode(['type' => 'something_else', 'watchTaskId' => 42], JSON_THROW_ON_ERROR));
    }

    private function makeRouter(WatchTaskRepositoryInterface $repository, DomainEventDispatcherInterface $dispatcher): WorkerEventRouter
    {
        return new WorkerEventRouter(
            new HandleCheckCompletedUseCase($repository, $dispatcher),
            new HandleCaptchaRequiredUseCase($repository, $dispatcher),
            new HandleCheckFailedUseCase($repository, $dispatcher),
        );
    }

    private function makeWatchTask(): WatchTask
    {
        return new WatchTask(
            id: 42,
            userId: 7,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com', documentType: DocumentTypeEnum::DNI, birthYear: 1990, nationality: 'España'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
