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
        if (trim($this->notificationTarget) === '') {
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
     * @param list<WatchTaskStatusEnum> $from
     */
    private function transitionTo(WatchTaskStatusEnum $to, array $from): void
    {
        if (! in_array($this->status, $from, true)) {
            throw InvalidWatchTaskTransitionException::fromStatusTo($this->status, $to);
        }

        $this->status = $to;
    }
}
