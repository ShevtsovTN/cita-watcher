<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Enums;

enum WatchTaskStatusEnum: string
{
    case PENDING = 'pending';
    case RUNNING = 'running';
    case PAUSED = 'paused';
    case COMPLETED = 'completed';
    case FAILED = 'failed';

    public function isTerminal(): bool
    {
        return match ($this) {
            self::COMPLETED, self::FAILED => true,
            self::PENDING, self::RUNNING, self::PAUSED => false,
        };
    }
}
