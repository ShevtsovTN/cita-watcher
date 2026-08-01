<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\UseCases;

use App\Application\Watcher\UseCases\ResumeWatchTaskUseCase;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class ResumeWatchTaskUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_resumes_the_watch_task_and_persists_it(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->pause();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->with($watchTask)->andReturn($watchTask);

        $useCase = new ResumeWatchTaskUseCase($repository);

        $result = $useCase->execute(42);

        $this->assertSame(WatchTaskStatusEnum::PENDING, $result->status());
    }

    public function test_it_throws_when_the_watch_task_does_not_exist(): void
    {
        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(99)->andReturn(null);

        $useCase = new ResumeWatchTaskUseCase($repository);

        $this->expectException(WatchTaskNotFoundException::class);

        $useCase->execute(99);
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
