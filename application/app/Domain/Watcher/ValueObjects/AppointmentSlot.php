<?php

declare(strict_types=1);

namespace App\Domain\Watcher\ValueObjects;

use DateTimeImmutable;

final readonly class AppointmentSlot
{
    public function __construct(
        public DateTimeImmutable $dateTime,
        public string $office,
    ) {}
}
