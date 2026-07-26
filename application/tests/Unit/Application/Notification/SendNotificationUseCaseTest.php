<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Notification;

use App\Application\Notification\Ports\NotificationChannelInterface;
use App\Application\Notification\UseCases\SendNotificationUseCase;
use App\Domain\Notification\Enums\DeliveryStatusEnum;
use App\Domain\Notification\ValueObjects\NotificationDeliveryReport;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class SendNotificationUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_delegates_sending_to_the_given_channel(): void
    {
        $message = new NotificationMessage('Slots found');
        $expectedReport = new NotificationDeliveryReport(
            channel: 'telegram',
            target: '123456789',
            status: DeliveryStatusEnum::DELIVERED,
        );

        $channel = Mockery::mock(NotificationChannelInterface::class);
        $channel->shouldReceive('send')
            ->once()
            ->with('123456789', $message)
            ->andReturn($expectedReport);

        $useCase = new SendNotificationUseCase($channel);

        $report = $useCase->execute('123456789', $message);

        $this->assertSame($expectedReport, $report);
    }

    public function test_it_returns_the_failure_report_without_throwing(): void
    {
        $message = new NotificationMessage('Slots found');
        $failedReport = new NotificationDeliveryReport(
            channel: 'telegram',
            target: '123456789',
            status: DeliveryStatusEnum::FAILED,
        );

        $channel = Mockery::mock(NotificationChannelInterface::class);
        $channel->shouldReceive('send')->once()->andReturn($failedReport);

        $useCase = new SendNotificationUseCase($channel);

        $report = $useCase->execute('123456789', $message);

        $this->assertFalse($report->isSuccessful());
    }
}
