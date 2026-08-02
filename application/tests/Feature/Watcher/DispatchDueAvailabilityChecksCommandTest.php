<?php

declare(strict_types=1);

namespace Tests\Feature\Watcher;

use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Persistence\Models\User;
use App\Presentation\Jobs\DispatchAvailabilityCheckJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class DispatchDueAvailabilityChecksCommandTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_enqueues_a_check_for_every_pending_watch_task_only(): void
    {
        Queue::fake();

        $user = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);

        $pending = $repository->save($this->makeWatchTask($user->id));
        $running = $repository->save($this->makeWatchTask($user->id));
        $running->start();
        $repository->save($running);

        $this->artisan('watcher:dispatch-due-checks')->assertExitCode(0);

        Queue::assertPushed(DispatchAvailabilityCheckJob::class, 1);
        Queue::assertPushed(fn(DispatchAvailabilityCheckJob $job): bool => $job->watchTaskId === $pending->id());
    }

    private function makeWatchTask(int $userId): WatchTask
    {
        return new WatchTask(
            id: null,
            userId: $userId,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
