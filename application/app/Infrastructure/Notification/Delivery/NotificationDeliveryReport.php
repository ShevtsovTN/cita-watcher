<?php

declare(strict_types=1);

namespace App\Infrastructure\Notification\Delivery;

use App\Domain\Notification\Enums\DeliveryStatusEnum;
use DateTimeInterface;

final readonly class NotificationDeliveryReport
{
    public function __construct(
        private string             $channel,
        private string             $target,
        private DeliveryStatusEnum $status,
        private ?string            $externalId = null,
        private ?DateTimeInterface $deliveredAt = null,
        private ?DeliveryFailure   $error = null,
    ) {}

    public function getChannel(): string
    {
        return $this->channel;
    }

    public function getTarget(): string
    {
        return $this->target;
    }

    public function getStatus(): DeliveryStatusEnum
    {
        return $this->status;
    }

    public function isSuccessful(): bool
    {
        return $this->status->isSuccessful();
    }

    public function getExternalId(): ?string
    {
        return $this->externalId;
    }

    public function getError(): ?DeliveryFailure
    {
        return $this->error;
    }

    public function getDeliveredAt(): ?DateTimeInterface
    {
        return $this->deliveredAt;
    }

    /**
     * Для логирования и отладки
     */
    public function toArray(): array
    {
        return [
            'channel' => $this->channel,
            'target' => $this->target,
            'status' => $this->status->value,
            'external_id' => $this->externalId,
            'delivered_at' => $this->deliveredAt?->format('Y-m-d H:i:s'),
            'error' => $this->error?->getMessage(),
        ];
    }
}
