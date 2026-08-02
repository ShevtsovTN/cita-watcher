<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Notification\Enums;

use App\Domain\Notification\Enums\DeliveryStatusEnum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class DeliveryStatusEnumTest extends TestCase
{
    public static function statuses(): array
    {
        return [
            'delivered' => [DeliveryStatusEnum::DELIVERED, true, false],
            'partially_delivered' => [DeliveryStatusEnum::PARTIALLY_DELIVERED, true, false],
            'failed' => [DeliveryStatusEnum::FAILED, false, true],
            'pending' => [DeliveryStatusEnum::PENDING, false, true],
        ];
    }

    #[DataProvider('statuses')]
    public function test_status_flags(DeliveryStatusEnum $status, bool $expectedSuccessful, bool $expectedRetryable): void
    {
        $this->assertSame($expectedSuccessful, $status->isSuccessful());
        $this->assertSame($expectedRetryable, $status->isRetryable());
    }
}
