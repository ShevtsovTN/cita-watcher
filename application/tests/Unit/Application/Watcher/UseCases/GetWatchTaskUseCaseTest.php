<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\UseCases;

use App\Application\Watcher\UseCases\GetWatchTaskUseCase;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class GetWatchTaskUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_returns_the_watch_task_when_owned_by_the_requesting_user(): void
    {
        $watchTask = $this->makeWatchTask();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);

        $useCase = new GetWatchTaskUseCase($repository);

        $this->assertSame($watchTask, $useCase->execute(42, requestingUserId: 7));
    }

    public function test_it_throws_when_the_watch_task_does_not_exist(): void
    {
        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(99)->andReturn(null);

        $useCase = new GetWatchTaskUseCase($repository);

        $this->expectException(WatchTaskNotFoundException::class);

        $useCase->execute(99, requestingUserId: 7);
    }

    public function test_it_throws_when_the_requesting_user_does_not_own_the_watch_task(): void
    {
        $watchTask = $this->makeWatchTask();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);

        $useCase = new GetWatchTaskUseCase($repository);

        $this->expectException(WatchTaskNotFoundException::class);

        $useCase->execute(42, requestingUserId: 999);
    }

    private function makeWatchTask(): WatchTask
    {
        return new WatchTask(
            id: 42,
            userId: 7,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
