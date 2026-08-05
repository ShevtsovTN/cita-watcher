<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\UseCases;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Application\Watcher\UseCases\ListWatchTasksUseCase;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class ListWatchTasksUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_returns_the_requesting_users_watch_tasks(): void
    {
        $watchTask = $this->makeWatchTask();

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('findByUserId')->once()->with(7)->andReturn([$watchTask]);

        $useCase = new ListWatchTasksUseCase($repository);

        $this->assertSame([$watchTask], $useCase->execute(requestingUserId: 7));
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
