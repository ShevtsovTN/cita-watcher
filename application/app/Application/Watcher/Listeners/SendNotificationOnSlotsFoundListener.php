<?php

declare(strict_types=1);

namespace App\Application\Watcher\Listeners;

use App\Application\Notification\UseCases\SendNotificationUseCase;
use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Events\SlotsFoundEvent;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\AppointmentSlot;

/**
 * Reacts to SlotsFoundEvent by sending a notification through the WatchTask's configured channel.
 * This is also the intended translation point between the Watcher and Notification bounded
 * contexts' separate channel enums (see docs/APPLICATION_ROADMAP.md Phase 1/3 notes) — neither
 * context reaches into the other's Domain layer directly.
 */
final readonly class SendNotificationOnSlotsFoundListener
{
    public function __construct(
        private WatchTaskRepositoryInterface $watchTaskRepository,
        private SendNotificationUseCase $sendNotificationUseCase,
    ) {}

    public function handle(SlotsFoundEvent $event): void
    {
        $watchTask = $this->watchTaskRepository->find($event->watchTaskId);

        if (null === $watchTask) {
            return;
        }

        $this->sendNotificationUseCase->execute(
            $this->toNotificationChannel($watchTask->notificationChannel()),
            $watchTask->notificationTarget(),
            new NotificationMessage($this->formatMessage($event->slots)),
        );
    }

    private function toNotificationChannel(WatchTaskNotificationChannelEnum $channel): NotificationChannelNameEnum
    {
        return match ($channel) {
            WatchTaskNotificationChannelEnum::MAIL => NotificationChannelNameEnum::MAIL,
            WatchTaskNotificationChannelEnum::TELEGRAM => NotificationChannelNameEnum::TELEGRAM,
        };
    }

    /**
     * @param list<AppointmentSlot> $slots
     */
    private function formatMessage(array $slots): string
    {
        $lines = array_map(
            static fn(AppointmentSlot $slot): string => sprintf('%s at %s', $slot->dateTime->format('Y-m-d H:i'), $slot->office),
            $slots,
        );

        return "Appointment slots found:\n" . implode("\n", $lines);
    }
}
