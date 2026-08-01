<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\Enums;

use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use PHPUnit\Framework\TestCase;

final class WatchTaskNotificationChannelEnumTest extends TestCase
{
    public function test_it_exposes_the_expected_backing_values(): void
    {
        $this->assertSame('mail', WatchTaskNotificationChannelEnum::MAIL->value);
        $this->assertSame('telegram', WatchTaskNotificationChannelEnum::TELEGRAM->value);
    }
}
