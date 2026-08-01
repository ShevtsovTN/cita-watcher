<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\Events;

use App\Domain\Watcher\Events\SlotsFoundEvent;
use App\Domain\Watcher\ValueObjects\AppointmentSlot;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

final class SlotsFoundEventTest extends TestCase
{
    public function test_constructor_assigns_all_properties(): void
    {
        $occurredAt = new DateTimeImmutable('2026-08-10 09:00:00');
        $slot = new AppointmentSlot(new DateTimeImmutable('2026-08-10 09:30:00'), 'Comisaría de Madrid Centro');

        $event = new SlotsFoundEvent(watchTaskId: 42, slots: [$slot], occurredAt: $occurredAt);

        $this->assertSame(42, $event->watchTaskId);
        $this->assertSame([$slot], $event->slots);
        $this->assertSame($occurredAt, $event->occurredAt);
    }
}
