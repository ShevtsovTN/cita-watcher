<?php

declare(strict_types=1);

namespace App\Infrastructure\Notification\Delivery;

final readonly class DeliveryFailure
{
    public function __construct(
        public int $code,
        public string $message,
        public bool $retryable = false
    ) {
    }

    public function getCode(): int
    {
        return $this->code;
    }

    public function getMessage(): string
    {
        return $this->message;
    }

    public function isRetryable(): bool
    {
        return $this->retryable;
    }
}
