<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Events;

use DateTimeImmutable;

final readonly class CheckFailedEvent
{
    public function __construct(
        public int $watchTaskId,
        public string $reason,
        public bool $retryable,
        public DateTimeImmutable $occurredAt,
    ) {}
}
