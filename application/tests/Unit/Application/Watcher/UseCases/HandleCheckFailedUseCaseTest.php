<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\UseCases;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Application\Watcher\Ports\DomainEventDispatcherInterface;
use App\Application\Watcher\UseCases\HandleCheckFailedUseCase;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Events\CheckFailedEvent;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use DateTimeImmutable;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class HandleCheckFailedUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_fails_the_watch_task_and_raises_check_failed_when_not_retryable(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $occurredAt = new DateTimeImmutable('2026-08-05 09:00');

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->with($watchTask)->andReturn($watchTask);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldReceive('dispatch')
            ->once()
            ->with(Mockery::on(function (CheckFailedEvent $event) use ($occurredAt): bool {
                return 42 === $event->watchTaskId
                    && 'invalid procedure' === $event->reason
                    && false === $event->retryable
                    && $occurredAt === $event->occurredAt;
            }));

        $useCase = new HandleCheckFailedUseCase($repository, $dispatcher);

        $useCase->execute(42, 'invalid procedure', retryable: false, occurredAt: $occurredAt);

        $this->assertSame(WatchTaskStatusEnum::FAILED, $watchTask->status());
    }

    public function test_it_retries_the_watch_task_and_raises_check_failed_when_retryable(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $occurredAt = new DateTimeImmutable('2026-08-05 09:00');

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->with($watchTask)->andReturn($watchTask);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldReceive('dispatch')
            ->once()
            ->with(Mockery::on(fn(CheckFailedEvent $event): bool => true === $event->retryable));

        $useCase = new HandleCheckFailedUseCase($repository, $dispatcher);

        $useCase->execute(42, 'navigation timeout', retryable: true, occurredAt: $occurredAt);

        $this->assertSame(WatchTaskStatusEnum::PENDING, $watchTask->status());
    }

    public function test_it_throws_when_the_watch_task_does_not_exist(): void
    {
        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(99)->andReturn(null);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldNotReceive('dispatch');

        $useCase = new HandleCheckFailedUseCase($repository, $dispatcher);

        $this->expectException(WatchTaskNotFoundException::class);

        $useCase->execute(99, 'boom', retryable: false, occurredAt: new DateTimeImmutable());
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
