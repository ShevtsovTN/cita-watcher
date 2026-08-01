<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\Events;

use App\Domain\Watcher\Events\CheckFailedEvent;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

final class CheckFailedEventTest extends TestCase
{
    public function test_constructor_assigns_all_properties(): void
    {
        $occurredAt = new DateTimeImmutable('2026-08-10 09:00:00');

        $event = new CheckFailedEvent(watchTaskId: 42, reason: 'Site returned 503', occurredAt: $occurredAt);

        $this->assertSame(42, $event->watchTaskId);
        $this->assertSame('Site returned 503', $event->reason);
        $this->assertSame($occurredAt, $event->occurredAt);
    }
}
