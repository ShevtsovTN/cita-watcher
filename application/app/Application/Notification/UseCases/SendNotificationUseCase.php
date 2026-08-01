<?php

declare(strict_types=1);

namespace App\Application\Notification\UseCases;

use App\Application\Notification\Ports\NotificationChannelResolverInterface;
use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Domain\Notification\ValueObjects\NotificationDeliveryReport;
use App\Domain\Notification\ValueObjects\NotificationMessage;

final readonly class SendNotificationUseCase
{
    public function __construct(
        private NotificationChannelResolverInterface $resolver,
    ) {}

    public function execute(NotificationChannelNameEnum $channel, string $target, NotificationMessage $message): NotificationDeliveryReport
    {
        return $this->resolver->resolve($channel)->send($target, $message);
    }
}
