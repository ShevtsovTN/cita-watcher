<?php

declare(strict_types=1);

namespace Tests\Feature\Watcher;

use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Persistence\Models\User;
use App\Infrastructure\Watcher\Messaging\WorkerEventRouter;
use App\Presentation\Console\Commands\ConsumeWatcherEventsCommand;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Points a real `single`-driver log channel at a throwaway file and inspects its actual contents
 * — the literal check the Phase 6 roadmap checklist asks for — rather than mocking the logger,
 * so a future change that naively logs a WatchTask/ApplicantData wholesale would be caught here.
 */
final class ApplicantDataDoesNotLeakToLogsTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_failed_worker_event_logs_the_error_without_leaking_applicant_data(): void
    {
        $logPath = storage_path('logs/phase6-pii-leak-check.log');
        @unlink($logPath);

        config(['logging.channels.phase6_test' => [
            'driver' => 'single',
            'path' => $logPath,
            'level' => 'debug',
        ]]);
        config(['logging.default' => 'phase6_test']);

        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $repository->save($this->makeWatchTask());

        $command = $this->app->make(ConsumeWatcherEventsCommand::class);
        $router = $this->app->make(WorkerEventRouter::class);

        $command->handleMessage('not valid json', $router);

        $this->assertFileExists($logPath);
        $contents = file_get_contents($logPath);

        $this->assertStringContainsString('watcher:consume-events failed to handle a message', $contents);
        $this->assertStringNotContainsString('Juan Pérez', $contents);
        $this->assertStringNotContainsString('12345678A', $contents);
        $this->assertStringNotContainsString('juan@example.com', $contents);
        $this->assertStringNotContainsString('600123456', $contents);

        @unlink($logPath);
    }

    private function makeWatchTask(): WatchTask
    {
        $user = User::factory()->create();

        return new WatchTask(
            id: null,
            userId: $user->id,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(
                fullName: 'Juan Pérez',
                documentId: '12345678A',
                email: 'juan@example.com',
                phone: '600123456',
            ),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
