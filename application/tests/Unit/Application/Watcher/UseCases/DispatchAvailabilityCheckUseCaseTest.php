<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\UseCases;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Application\Watcher\Ports\WorkerGatewayInterface;
use App\Application\Watcher\UseCases\DispatchAvailabilityCheckUseCase;
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

final class DispatchAvailabilityCheckUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_dispatches_via_the_gateway_and_transitions_the_task_to_running(): void
    {
        $watchTask = $this->makeWatchTask();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);
        $repository->shouldReceive('save')->once()->with($watchTask)->andReturn($watchTask);

        $gateway = Mockery::mock(WorkerGatewayInterface::class);
        $gateway->shouldReceive('dispatchAvailabilityCheck')->once()->with($watchTask);

        $useCase = new DispatchAvailabilityCheckUseCase($repository, $gateway);

        $useCase->execute(42);

        $this->assertSame(WatchTaskStatusEnum::RUNNING, $watchTask->status());
    }

    public function test_it_throws_when_the_watch_task_does_not_exist(): void
    {
        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(99)->andReturn(null);

        $gateway = Mockery::mock(WorkerGatewayInterface::class);
        $gateway->shouldNotReceive('dispatchAvailabilityCheck');

        $useCase = new DispatchAvailabilityCheckUseCase($repository, $gateway);

        $this->expectException(WatchTaskNotFoundException::class);

        $useCase->execute(99);
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
