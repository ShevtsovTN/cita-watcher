<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher;

use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Exceptions\InvalidWatchTaskException;
use App\Domain\Watcher\Exceptions\InvalidWatchTaskTransitionException;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use PHPUnit\Framework\TestCase;

final class WatchTaskTest extends TestCase
{
    public function test_constructor_assigns_properties_and_defaults_to_pending(): void
    {
        $watchTask = $this->makeWatchTask();

        $this->assertNull($watchTask->id());
        $this->assertSame(7, $watchTask->userId());
        $this->assertSame(WatchTaskStatusEnum::PENDING, $watchTask->status());
        $this->assertSame(WatchTaskNotificationChannelEnum::TELEGRAM, $watchTask->notificationChannel());
        $this->assertSame('123456789', $watchTask->notificationTarget());
    }

    public function test_it_rejects_a_blank_notification_target(): void
    {
        $this->expectException(InvalidWatchTaskException::class);

        $this->makeWatchTask(notificationTarget: '  ');
    }

    public function test_start_transitions_from_pending_to_running(): void
    {
        $watchTask = $this->makeWatchTask();

        $watchTask->start();

        $this->assertSame(WatchTaskStatusEnum::RUNNING, $watchTask->status());
    }

    public function test_start_from_a_non_pending_status_throws(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $this->expectException(InvalidWatchTaskTransitionException::class);

        $watchTask->start();
    }

    public function test_pause_transitions_from_running_to_paused(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $watchTask->pause();

        $this->assertSame(WatchTaskStatusEnum::PAUSED, $watchTask->status());
    }

    public function test_pause_from_a_terminal_status_throws(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();
        $watchTask->complete();

        $this->expectException(InvalidWatchTaskTransitionException::class);

        $watchTask->pause();
    }

    public function test_resume_transitions_from_paused_to_pending(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->pause();

        $watchTask->resume();

        $this->assertSame(WatchTaskStatusEnum::PENDING, $watchTask->status());
    }

    public function test_resume_from_a_non_paused_status_throws(): void
    {
        $watchTask = $this->makeWatchTask();

        $this->expectException(InvalidWatchTaskTransitionException::class);

        $watchTask->resume();
    }

    public function test_complete_transitions_from_running_to_completed(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $watchTask->complete();

        $this->assertSame(WatchTaskStatusEnum::COMPLETED, $watchTask->status());
    }

    public function test_complete_from_a_non_running_status_throws(): void
    {
        $watchTask = $this->makeWatchTask();

        $this->expectException(InvalidWatchTaskTransitionException::class);

        $watchTask->complete();
    }

    public function test_fail_transitions_from_running_to_failed(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $watchTask->fail();

        $this->assertSame(WatchTaskStatusEnum::FAILED, $watchTask->status());
    }

    public function test_fail_from_a_non_running_status_throws(): void
    {
        $watchTask = $this->makeWatchTask();

        $this->expectException(InvalidWatchTaskTransitionException::class);

        $watchTask->fail();
    }

    public function test_recheck_transitions_from_running_to_pending(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $watchTask->recheck();

        $this->assertSame(WatchTaskStatusEnum::PENDING, $watchTask->status());
    }

    public function test_recheck_from_a_non_running_status_throws(): void
    {
        $watchTask = $this->makeWatchTask();

        $this->expectException(InvalidWatchTaskTransitionException::class);

        $watchTask->recheck();
    }

    public function test_retry_transitions_from_running_to_pending(): void
    {
        $watchTask = $this->makeWatchTask();
        $watchTask->start();

        $watchTask->retry();

        $this->assertSame(WatchTaskStatusEnum::PENDING, $watchTask->status());
    }

    public function test_retry_from_a_non_running_status_throws(): void
    {
        $watchTask = $this->makeWatchTask();

        $this->expectException(InvalidWatchTaskTransitionException::class);

        $watchTask->retry();
    }

    private function makeWatchTask(?string $notificationTarget = null): WatchTask
    {
        return new WatchTask(
            id: null,
            userId: 7,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: $notificationTarget ?? '123456789',
        );
    }
}
