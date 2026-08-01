<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\ValueObjects;

use App\Domain\Watcher\ValueObjects\AppointmentSlot;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

final class AppointmentSlotTest extends TestCase
{
    public function test_constructor_assigns_date_time_and_office(): void
    {
        $dateTime = new DateTimeImmutable('2026-08-10 09:30:00');

        $slot = new AppointmentSlot(dateTime: $dateTime, office: 'Comisaría de Madrid Centro');

        $this->assertSame($dateTime, $slot->dateTime);
        $this->assertSame('Comisaría de Madrid Centro', $slot->office);
    }
}
