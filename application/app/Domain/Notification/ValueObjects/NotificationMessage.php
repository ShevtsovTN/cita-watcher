<?php

declare(strict_types=1);

namespace App\Domain\Notification\ValueObjects;

final readonly class NotificationMessage
{
    public function __construct(
        public string $text,
        public ?string $parseMode = 'HTML',
        public array $additionalParams = []
    ) {}
}
