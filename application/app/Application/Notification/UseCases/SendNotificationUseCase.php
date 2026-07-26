<?php

declare(strict_types=1);

namespace App\Application\Notification\UseCases;

use App\Application\Notification\Ports\NotificationChannelInterface;
use App\Domain\Notification\ValueObjects\NotificationDeliveryReport;
use App\Domain\Notification\ValueObjects\NotificationMessage;

final readonly class SendNotificationUseCase
{
    public function __construct(
        private NotificationChannelInterface $channel,
    ) {}

    public function execute(string $target, NotificationMessage $message): NotificationDeliveryReport
    {
        return $this->channel->send($target, $message);
    }
}
