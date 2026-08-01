<?php

declare(strict_types=1);

namespace App\Application\Notification\Ports;

use App\Domain\Notification\ValueObjects\NotificationDeliveryReport;
use App\Domain\Notification\ValueObjects\NotificationMessage;

interface NotificationChannelInterface
{
    public function send(string $target, NotificationMessage $message): NotificationDeliveryReport;
}
