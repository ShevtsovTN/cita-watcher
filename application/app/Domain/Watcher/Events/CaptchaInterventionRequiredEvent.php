<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Events;

use DateTimeImmutable;

final readonly class CaptchaInterventionRequiredEvent
{
    public function __construct(
        public int $watchTaskId,
        public DateTimeImmutable $occurredAt,
    ) {}
}
