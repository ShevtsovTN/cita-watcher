<?php

declare(strict_types=1);

namespace Tests\Feature\Watcher;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
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
 * Points a real `single`-driver log channel at a throwaway file, same approach as
 * ApplicantDataDoesNotLeakToLogsTest, to verify the Phase 8 watch_task_id/command_id log
 * correlation actually lands in the log output rather than mocking the logger.
 */
final class ConsumeWatcherEventsCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_handling_a_message_logs_watch_task_and_command_id_context(): void
    {
        $logPath = storage_path('logs/phase8-correlation-check.log');
        @unlink($logPath);

        config(['logging.channels.phase8_test' => [
            'driver' => 'single',
            'path' => $logPath,
            'level' => 'debug',
        ]]);
        config(['logging.default' => 'phase8_test']);

        $user = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask($user->id));
        $watchTask->start();
        $repository->save($watchTask);

        $command = $this->app->make(ConsumeWatcherEventsCommand::class);
        $router = $this->app->make(WorkerEventRouter::class);

        $command->handleMessage(json_encode([
            'type' => 'check_failed',
            'watchTaskId' => $watchTask->id(),
            'commandId' => 'a1b2c3d4-0000-0000-0000-000000000000',
            'reason' => 'navigation timeout',
            'retryable' => true,
            'occurredAt' => '2026-08-05T09:00:00+00:00',
        ], JSON_THROW_ON_ERROR), $router);

        $this->assertFileExists($logPath);
        $contents = file_get_contents($logPath);

        $this->assertStringContainsString('Handled a worker event.', $contents);
        $this->assertStringContainsString((string) $watchTask->id(), $contents);
        $this->assertStringContainsString('a1b2c3d4-0000-0000-0000-000000000000', $contents);

        @unlink($logPath);
    }

    private function makeWatchTask(int $userId): WatchTask
    {
        return new WatchTask(
            id: null,
            userId: $userId,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com', documentType: DocumentTypeEnum::DNI, birthYear: 1990, nationality: 'España'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
