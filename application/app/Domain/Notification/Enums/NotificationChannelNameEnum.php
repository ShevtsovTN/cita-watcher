<?php

declare(strict_types=1);

namespace App\Domain\Notification\Enums;

enum NotificationChannelNameEnum: string
{
    case MAIL = 'mail';
    case TELEGRAM = 'telegram';
}
