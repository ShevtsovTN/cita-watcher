<?php

declare(strict_types=1);

namespace App\Infrastructure\Notification\Channels;

use App\Application\Notification\Ports\NotificationChannelInterface;
use App\Domain\Notification\Enums\DeliveryStatusEnum;
use App\Domain\Notification\ValueObjects\DeliveryFailure;
use App\Domain\Notification\ValueObjects\NotificationDeliveryReport;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use DateTimeImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;

final readonly class TelegramNotificationChannel implements NotificationChannelInterface
{
    private const string API_BASE_URL = 'https://api.telegram.org';

    public function __construct(
        private Factory $http,
        private string $botToken,
    ) {}

    public function send(string $target, NotificationMessage $message): NotificationDeliveryReport
    {
        try {
            $response = $this->http->post(self::API_BASE_URL.'/bot'.$this->botToken.'/sendMessage', [
                'chat_id' => $target,
                'text' => $message->text,
                'parse_mode' => $message->parseMode,
                ...$message->additionalParams,
            ]);
        } catch (ConnectionException $exception) {
            return new NotificationDeliveryReport(
                channel: 'telegram',
                target: $target,
                status: DeliveryStatusEnum::FAILED,
                error: new DeliveryFailure(code: 0, message: $exception->getMessage(), retryable: true),
            );
        }

        if ($response->successful() && ($response->json('ok') === true)) {
            return new NotificationDeliveryReport(
                channel: 'telegram',
                target: $target,
                status: DeliveryStatusEnum::DELIVERED,
                externalId: (string) $response->json('result.message_id'),
                deliveredAt: new DateTimeImmutable,
            );
        }

        return new NotificationDeliveryReport(
            channel: 'telegram',
            target: $target,
            status: DeliveryStatusEnum::FAILED,
            error: new DeliveryFailure(
                code: $response->status(),
                message: (string) ($response->json('description') ?? $response->body()),
                retryable: $response->status() === 429 || $response->serverError(),
            ),
        );
    }
}
