<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Exceptions;

use DomainException;

final class WatchTaskNotFoundException extends DomainException
{
    public static function withId(int $id): self
    {
        return new self(sprintf('WatchTask with id "%d" was not found.', $id));
    }
}
