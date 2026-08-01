<?php

declare(strict_types=1);

namespace App\Infrastructure\Notification;

use App\Application\Notification\Ports\NotificationChannelInterface;
use App\Application\Notification\Ports\NotificationChannelResolverInterface;
use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Infrastructure\Notification\Channels\MailNotificationChannel;
use App\Infrastructure\Notification\Channels\TelegramNotificationChannel;

final readonly class NotificationChannelResolver implements NotificationChannelResolverInterface
{
    public function __construct(
        private MailNotificationChannel $mailChannel,
        private TelegramNotificationChannel $telegramChannel,
    ) {}

    public function resolve(NotificationChannelNameEnum $channel): NotificationChannelInterface
    {
        return match ($channel) {
            NotificationChannelNameEnum::MAIL => $this->mailChannel,
            NotificationChannelNameEnum::TELEGRAM => $this->telegramChannel,
        };
    }
}
