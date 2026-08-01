<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Notification\Enums;

use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use PHPUnit\Framework\TestCase;

final class NotificationChannelNameEnumTest extends TestCase
{
    public function test_it_exposes_the_expected_backing_values(): void
    {
        $this->assertSame('mail', NotificationChannelNameEnum::MAIL->value);
        $this->assertSame('telegram', NotificationChannelNameEnum::TELEGRAM->value);
    }

    public function test_it_can_be_constructed_from_its_backing_value(): void
    {
        $this->assertSame(NotificationChannelNameEnum::MAIL, NotificationChannelNameEnum::from('mail'));
        $this->assertSame(NotificationChannelNameEnum::TELEGRAM, NotificationChannelNameEnum::from('telegram'));
    }
}
