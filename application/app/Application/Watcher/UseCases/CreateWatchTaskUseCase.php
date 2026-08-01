<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;

final readonly class CreateWatchTaskUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
    ) {}

    public function execute(
        int $userId,
        Procedure $procedure,
        ApplicantData $applicantData,
        WatchTaskNotificationChannelEnum $notificationChannel,
        string $notificationTarget,
    ): WatchTask {
        $watchTask = new WatchTask(
            id: null,
            userId: $userId,
            procedure: $procedure,
            applicantData: $applicantData,
            notificationChannel: $notificationChannel,
            notificationTarget: $notificationTarget,
        );

        return $this->repository->save($watchTask);
    }
}
