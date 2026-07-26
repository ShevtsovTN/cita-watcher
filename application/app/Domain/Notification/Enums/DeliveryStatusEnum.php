<?php

declare(strict_types=1);

namespace App\Domain\Notification\Enums;

enum DeliveryStatusEnum: string
{
    case DELIVERED = 'delivered';
    case FAILED = 'failed';
    case PENDING = 'pending';
    case PARTIALLY_DELIVERED = 'partially_delivered';

    public function isSuccessful(): bool
    {
        return match ($this) {
            self::DELIVERED, self::PARTIALLY_DELIVERED => true,
            self::FAILED, self::PENDING => false,
        };
    }

    public function isRetryable(): bool
    {
        return match ($this) {
            self::FAILED, self::PENDING => true,  // failed - can retry / pending — let's try again later
            self::DELIVERED, self::PARTIALLY_DELIVERED => false,
        };
    }
}
