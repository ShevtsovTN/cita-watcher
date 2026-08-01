<?php

declare(strict_types=1);

namespace App\Application\Notification\Ports;

use App\Domain\Notification\Enums\NotificationChannelNameEnum;

interface NotificationChannelResolverInterface
{
    public function resolve(NotificationChannelNameEnum $channel): NotificationChannelInterface;
}
