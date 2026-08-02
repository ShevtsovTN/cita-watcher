<?php

declare(strict_types=1);

namespace App\Application\Watcher\Listeners;

use App\Application\Notification\UseCases\SendNotificationUseCase;
use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Events\CheckFailedEvent;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;

/**
 * Reacts to CheckFailedEvent by letting the user know their watch stopped, through the WatchTask's
 * configured channel — same cross-context enum translation as SendNotificationOnSlotsFoundListener.
 */
final readonly class SendNotificationOnCheckFailedListener
{
    public function __construct(
        private WatchTaskRepositoryInterface $watchTaskRepository,
        private SendNotificationUseCase $sendNotificationUseCase,
    ) {}

    public function handle(CheckFailedEvent $event): void
    {
        $watchTask = $this->watchTaskRepository->find($event->watchTaskId);

        if (null === $watchTask) {
            return;
        }

        $this->sendNotificationUseCase->execute(
            $this->toNotificationChannel($watchTask->notificationChannel()),
            $watchTask->notificationTarget(),
            new NotificationMessage(sprintf('Watch task stopped: %s', $event->reason)),
        );
    }

    private function toNotificationChannel(WatchTaskNotificationChannelEnum $channel): NotificationChannelNameEnum
    {
        return match ($channel) {
            WatchTaskNotificationChannelEnum::MAIL => NotificationChannelNameEnum::MAIL,
            WatchTaskNotificationChannelEnum::TELEGRAM => NotificationChannelNameEnum::TELEGRAM,
        };
    }
}
