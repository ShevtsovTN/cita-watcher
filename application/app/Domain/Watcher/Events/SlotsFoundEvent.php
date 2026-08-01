<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Events;

use App\Domain\Watcher\ValueObjects\AppointmentSlot;
use DateTimeImmutable;

final readonly class SlotsFoundEvent
{
    /**
     * @param list<AppointmentSlot> $slots
     */
    public function __construct(
        public int $watchTaskId,
        public array $slots,
        public DateTimeImmutable $occurredAt,
    ) {}
}
