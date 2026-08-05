<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\UseCases;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Application\Watcher\Ports\DomainEventDispatcherInterface;
use App\Application\Watcher\UseCases\HandleCheckCompletedUseCase;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Events\SlotsFoundEvent;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\AppointmentSlot;
use App\Domain\Watcher\ValueObjects\CheckResult;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use DateTimeImmutable;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class HandleCheckCompletedUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_completes_the_watch_task_and_raises_slots_found_when_slots_are_present(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $slot = new AppointmentSlot(new DateTimeImmutable('2026-08-10 10:00'), 'Madrid Office');
        $checkedAt = new DateTimeImmutable('2026-08-05 09:00');
        $result = new CheckResult(slots: [$slot], checkedAt: $checkedAt);

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->with($watchTask)->andReturn($watchTask);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldReceive('dispatch')
            ->once()
            ->with(Mockery::on(function (SlotsFoundEvent $event) use ($slot, $checkedAt): bool {
                return 42 === $event->watchTaskId
                    && [$slot] === $event->slots
                    && $checkedAt === $event->occurredAt;
            }));

        $useCase = new HandleCheckCompletedUseCase($repository, $dispatcher);

        $useCase->execute(42, $result);

        $this->assertSame(WatchTaskStatusEnum::COMPLETED, $watchTask->status());
    }

    public function test_it_sends_the_watch_task_back_to_pending_when_no_slots_are_found(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $result = new CheckResult(slots: [], checkedAt: new DateTimeImmutable());

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->with($watchTask)->andReturn($watchTask);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldNotReceive('dispatch');

        $useCase = new HandleCheckCompletedUseCase($repository, $dispatcher);

        $useCase->execute(42, $result);

        $this->assertSame(WatchTaskStatusEnum::PENDING, $watchTask->status());
    }

    public function test_it_throws_when_the_watch_task_does_not_exist(): void
    {
        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(99)->andReturn(null);

        $dispatcher = Mockery::mock(DomainEventDispatcherInterface::class);
        $dispatcher->shouldNotReceive('dispatch');

        $useCase = new HandleCheckCompletedUseCase($repository, $dispatcher);

        $this->expectException(WatchTaskNotFoundException::class);

        $useCase->execute(99, new CheckResult(slots: [], checkedAt: new DateTimeImmutable()));
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
