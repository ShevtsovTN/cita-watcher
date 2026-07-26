<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Notification\Delivery;

use App\Domain\Notification\Enums\DeliveryStatusEnum;
use App\Infrastructure\Notification\Delivery\DeliveryFailure;
use App\Infrastructure\Notification\Delivery\NotificationDeliveryReport;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

final class NotificationDeliveryReportTest extends TestCase
{
    public function test_successful_report_exposes_channel_target_and_delivered_at(): void
    {
        $deliveredAt = new DateTimeImmutable('2026-07-26 10:00:00');

        $report = new NotificationDeliveryReport(
            channel: 'telegram',
            target: '123456789',
            status: DeliveryStatusEnum::DELIVERED,
            externalId: 'msg-1',
            deliveredAt: $deliveredAt,
        );

        $this->assertSame('telegram', $report->getChannel());
        $this->assertSame('123456789', $report->getTarget());
        $this->assertSame(DeliveryStatusEnum::DELIVERED, $report->getStatus());
        $this->assertSame('msg-1', $report->getExternalId());
        $this->assertSame($deliveredAt, $report->getDeliveredAt());
        $this->assertNull($report->getError());
        $this->assertTrue($report->isSuccessful());
    }

    public function test_failed_report_exposes_error_and_is_not_successful(): void
    {
        $error = new DeliveryFailure(code: 500, message: 'Internal Server Error', retryable: true);

        $report = new NotificationDeliveryReport(
            channel: 'mail',
            target: 'user@example.com',
            status: DeliveryStatusEnum::FAILED,
            error: $error,
        );

        $this->assertFalse($report->isSuccessful());
        $this->assertSame($error, $report->getError());
        $this->assertNull($report->getExternalId());
        $this->assertNull($report->getDeliveredAt());
    }

    public function test_to_array_formats_delivered_at_and_flattens_error_message(): void
    {
        $deliveredAt = new DateTimeImmutable('2026-07-26 10:00:00');
        $error = new DeliveryFailure(code: 429, message: 'Too Many Requests', retryable: true);

        $report = new NotificationDeliveryReport(
            channel: 'telegram',
            target: '123456789',
            status: DeliveryStatusEnum::PARTIALLY_DELIVERED,
            deliveredAt: $deliveredAt,
            error: $error,
        );

        $this->assertSame(
            [
                'channel' => 'telegram',
                'target' => '123456789',
                'status' => 'partially_delivered',
                'external_id' => null,
                'delivered_at' => '2026-07-26 10:00:00',
                'error' => 'Too Many Requests',
            ],
            $report->toArray(),
        );
    }

    public function test_to_array_handles_null_delivered_at_and_null_error(): void
    {
        $report = new NotificationDeliveryReport(
            channel: 'mail',
            target: 'user@example.com',
            status: DeliveryStatusEnum::PENDING,
        );

        $this->assertNull($report->toArray()['delivered_at']);
        $this->assertNull($report->toArray()['error']);
    }
}
