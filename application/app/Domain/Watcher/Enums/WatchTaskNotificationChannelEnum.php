<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Enums;

/**
 * The Watcher context's own notification-channel vocabulary. Deliberately not the same type as
 * App\Domain\Notification\Enums\NotificationChannelNameEnum — bounded contexts don't reach across
 * into each other's Domain layer; the Application layer maps between the two when it actually
 * sends a notification (see docs/APPLICATION_ROADMAP.md Phase 3).
 */
enum WatchTaskNotificationChannelEnum: string
{
    case MAIL = 'mail';
    case TELEGRAM = 'telegram';
}
