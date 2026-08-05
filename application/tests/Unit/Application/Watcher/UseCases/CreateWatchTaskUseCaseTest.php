<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\UseCases;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Application\Watcher\UseCases\CreateWatchTaskUseCase;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class CreateWatchTaskUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_builds_a_watch_task_and_persists_it_via_the_repository(): void
    {
        $procedure = new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI');
        $applicantData = new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com', documentType: DocumentTypeEnum::DNI, birthYear: 1990, nationality: 'España');

        $persisted = new WatchTask(
            id: 42,
            userId: 7,
            procedure: $procedure,
            applicantData: $applicantData,
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('save')
            ->once()
            ->with(Mockery::on(function (WatchTask $watchTask) use ($procedure, $applicantData): bool {
                return null === $watchTask->id()
                    && 7 === $watchTask->userId()
                    && $watchTask->procedure() === $procedure
                    && $watchTask->applicantData() === $applicantData
                    && WatchTaskNotificationChannelEnum::TELEGRAM === $watchTask->notificationChannel()
                    && '123456789' === $watchTask->notificationTarget();
            }))
            ->andReturn($persisted);

        $useCase = new CreateWatchTaskUseCase($repository);

        $result = $useCase->execute(
            userId: 7,
            procedure: $procedure,
            applicantData: $applicantData,
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );

        $this->assertSame($persisted, $result);
    }
}
