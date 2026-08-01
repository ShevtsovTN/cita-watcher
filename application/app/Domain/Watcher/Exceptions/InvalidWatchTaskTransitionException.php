<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Exceptions;

use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use DomainException;

final class InvalidWatchTaskTransitionException extends DomainException
{
    public static function fromStatusTo(WatchTaskStatusEnum $from, WatchTaskStatusEnum $to): self
    {
        return new self(sprintf(
            'Cannot transition a WatchTask from "%s" to "%s".',
            $from->value,
            $to->value,
        ));
    }
}
