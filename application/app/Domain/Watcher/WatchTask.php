<?php

declare(strict_types=1);

namespace App\Domain\Watcher;

use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Exceptions\InvalidWatchTaskException;
use App\Domain\Watcher\Exceptions\InvalidWatchTaskTransitionException;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;

final class WatchTask
{
    private WatchTaskStatusEnum $status;

    public function __construct(
        private readonly ?int $id,
        private readonly int $userId,
        private readonly Procedure $procedure,
        private readonly ApplicantData $applicantData,
        private readonly WatchTaskNotificationChannelEnum $notificationChannel,
        private readonly string $notificationTarget,
        WatchTaskStatusEnum $status = WatchTaskStatusEnum::PENDING,
    ) {
        if ('' === mb_trim($this->notificationTarget)) {
            throw new InvalidWatchTaskException('WatchTask notification target must not be blank.');
        }

        $this->status = $status;
    }

    public function id(): ?int
    {
        return $this->id;
    }

    public function userId(): int
    {
        return $this->userId;
    }

    public function procedure(): Procedure
    {
        return $this->procedure;
    }

    public function applicantData(): ApplicantData
    {
        return $this->applicantData;
    }

    public function notificationChannel(): WatchTaskNotificationChannelEnum
    {
        return $this->notificationChannel;
    }

    public function notificationTarget(): string
    {
        return $this->notificationTarget;
    }

    public function status(): WatchTaskStatusEnum
    {
        return $this->status;
    }

    public function start(): void
    {
        $this->transitionTo(WatchTaskStatusEnum::RUNNING, from: [WatchTaskStatusEnum::PENDING]);
    }

    public function pause(): void
    {
        $this->transitionTo(
            WatchTaskStatusEnum::PAUSED,
            from: [WatchTaskStatusEnum::PENDING, WatchTaskStatusEnum::RUNNING],
        );
    }

    public function resume(): void
    {
        $this->transitionTo(WatchTaskStatusEnum::PENDING, from: [WatchTaskStatusEnum::PAUSED]);
    }

    public function complete(): void
    {
        $this->transitionTo(WatchTaskStatusEnum::COMPLETED, from: [WatchTaskStatusEnum::RUNNING]);
    }

    public function fail(): void
    {
        $this->transitionTo(WatchTaskStatusEnum::FAILED, from: [WatchTaskStatusEnum::RUNNING]);
    }

    /**
     * A completed check found no slots yet — go back to PENDING so the next scheduled dispatch
     * (see DispatchDueAvailabilityChecksCommand) picks this WatchTask up again. Distinct from
     * complete(), which is reserved for "slots found, done watching".
     */
    public function recheck(): void
    {
        $this->transitionTo(WatchTaskStatusEnum::PENDING, from: [WatchTaskStatusEnum::RUNNING]);
    }

    /**
     * A check failed for a retryable reason (e.g. a transient network/site error, per
     * CheckFailedEvent::$retryable) — go back to PENDING for another attempt, same transition as
     * recheck() but a distinct method because the domain reason differs: this is "the attempt
     * itself failed," not "the attempt succeeded and found nothing."
     */
    public function retry(): void
    {
        $this->transitionTo(WatchTaskStatusEnum::PENDING, from: [WatchTaskStatusEnum::RUNNING]);
    }

    /**
     * @param list<WatchTaskStatusEnum> $from
     */
    private function transitionTo(WatchTaskStatusEnum $to, array $from): void
    {
        if ( ! in_array($this->status, $from, true)) {
            throw InvalidWatchTaskTransitionException::fromStatusTo($this->status, $to);
        }

        $this->status = $to;
    }
}
