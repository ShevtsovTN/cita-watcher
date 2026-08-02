<?php

declare(strict_types=1);

namespace App\Domain\Watcher\ValueObjects;

use DateTimeImmutable;

final readonly class CheckResult
{
    /**
     * @param list<AppointmentSlot> $slots
     */
    public function __construct(
        public array $slots,
        public DateTimeImmutable $checkedAt,
    ) {}

    public function slotsFound(): bool
    {
        return [] !== $this->slots;
    }
}
