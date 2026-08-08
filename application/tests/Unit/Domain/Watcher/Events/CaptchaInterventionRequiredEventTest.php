<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\Events;

use App\Domain\Watcher\Events\CaptchaInterventionRequiredEvent;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

final class CaptchaInterventionRequiredEventTest extends TestCase
{
    public function test_constructor_assigns_all_properties(): void
    {
        $occurredAt = new DateTimeImmutable('2026-08-10 09:00:00');

        $event = new CaptchaInterventionRequiredEvent(watchTaskId: 42, sessionToken: 'abc123', occurredAt: $occurredAt);

        $this->assertSame(42, $event->watchTaskId);
        $this->assertSame('abc123', $event->sessionToken);
        $this->assertSame($occurredAt, $event->occurredAt);
    }
}
