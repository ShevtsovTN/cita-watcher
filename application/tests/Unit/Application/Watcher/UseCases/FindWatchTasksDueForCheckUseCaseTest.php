<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\UseCases;

use App\Application\Watcher\UseCases\FindWatchTasksDueForCheckUseCase;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class FindWatchTasksDueForCheckUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_returns_all_pending_tasks_when_under_the_concurrency_limit(): void
    {
        $pending = [$this->makeWatchTask(1), $this->makeWatchTask(2)];

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('countRunning')->once()->andReturn(0);
        $repository->shouldReceive('findPending')->once()->andReturn($pending);

        $useCase = new FindWatchTasksDueForCheckUseCase($repository, maxConcurrentSessions: 3);

        $this->assertSame($pending, $useCase->execute());
    }

    public function test_it_caps_the_result_to_the_remaining_concurrency_slots(): void
    {
        $pending = [$this->makeWatchTask(1), $this->makeWatchTask(2), $this->makeWatchTask(3)];

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('countRunning')->once()->andReturn(2);
        $repository->shouldReceive('findPending')->once()->andReturn($pending);

        $useCase = new FindWatchTasksDueForCheckUseCase($repository, maxConcurrentSessions: 3);

        $result = $useCase->execute();

        $this->assertCount(1, $result);
        $this->assertSame($pending[0], $result[0]);
    }

    public function test_it_returns_nothing_when_already_at_the_concurrency_limit(): void
    {
        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('countRunning')->once()->andReturn(5);
        $repository->shouldReceive('findPending')->once()->andReturn([$this->makeWatchTask(1)]);

        $useCase = new FindWatchTasksDueForCheckUseCase($repository, maxConcurrentSessions: 3);

        $this->assertSame([], $useCase->execute());
    }

    private function makeWatchTask(int $id): WatchTask
    {
        return new WatchTask(
            id: $id,
            userId: 7,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
