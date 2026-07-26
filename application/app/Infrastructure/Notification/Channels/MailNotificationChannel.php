<?php

declare(strict_types=1);

namespace App\Infrastructure\Notification\Channels;

use App\Application\Notification\Ports\NotificationChannelInterface;
use App\Domain\Notification\Enums\DeliveryStatusEnum;
use App\Domain\Notification\ValueObjects\DeliveryFailure;
use App\Domain\Notification\ValueObjects\NotificationDeliveryReport;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use DateTimeImmutable;
use Illuminate\Contracts\Mail\Mailer;
use Illuminate\Mail\Message;
use Throwable;

final readonly class MailNotificationChannel implements NotificationChannelInterface
{
    public function __construct(
        private Mailer $mailer,
    ) {}

    public function send(string $target, NotificationMessage $message): NotificationDeliveryReport
    {
        try {
            $this->mailer->raw($message->text, function (Message $mail) use ($target): void {
                $mail->to($target);
            });
        } catch (Throwable $exception) {
            return new NotificationDeliveryReport(
                channel: 'mail',
                target: $target,
                status: DeliveryStatusEnum::FAILED,
                error: new DeliveryFailure(code: 0, message: $exception->getMessage(), retryable: true),
            );
        }

        return new NotificationDeliveryReport(
            channel: 'mail',
            target: $target,
            status: DeliveryStatusEnum::DELIVERED,
            deliveredAt: new DateTimeImmutable,
        );
    }
}
