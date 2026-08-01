<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\ValueObjects;

use App\Domain\Watcher\ValueObjects\AppointmentSlot;
use App\Domain\Watcher\ValueObjects\CheckResult;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

final class CheckResultTest extends TestCase
{
    public function test_slots_found_is_true_when_slots_are_present(): void
    {
        $checkedAt = new DateTimeImmutable('2026-08-10 09:00:00');
        $slot = new AppointmentSlot(new DateTimeImmutable('2026-08-10 09:30:00'), 'Comisaría de Madrid Centro');

        $result = new CheckResult(slots: [$slot], checkedAt: $checkedAt);

        $this->assertTrue($result->slotsFound());
        $this->assertSame([$slot], $result->slots);
        $this->assertSame($checkedAt, $result->checkedAt);
    }

    public function test_slots_found_is_false_when_no_slots_are_present(): void
    {
        $result = new CheckResult(slots: [], checkedAt: new DateTimeImmutable('2026-08-10 09:00:00'));

        $this->assertFalse($result->slotsFound());
    }
}
