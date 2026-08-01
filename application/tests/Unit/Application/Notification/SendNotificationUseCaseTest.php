<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Notification;

use App\Application\Notification\Ports\NotificationChannelInterface;
use App\Application\Notification\Ports\NotificationChannelResolverInterface;
use App\Application\Notification\UseCases\SendNotificationUseCase;
use App\Domain\Notification\Enums\DeliveryStatusEnum;
use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Domain\Notification\ValueObjects\NotificationDeliveryReport;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class SendNotificationUseCaseTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_resolves_the_requested_channel_and_delegates_sending_to_it(): void
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

        $resolver = Mockery::mock(NotificationChannelResolverInterface::class);
        $resolver->shouldReceive('resolve')
            ->once()
            ->with(NotificationChannelNameEnum::TELEGRAM)
            ->andReturn($channel);

        $useCase = new SendNotificationUseCase($resolver);

        $report = $useCase->execute(NotificationChannelNameEnum::TELEGRAM, '123456789', $message);

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

        $resolver = Mockery::mock(NotificationChannelResolverInterface::class);
        $resolver->shouldReceive('resolve')->once()->andReturn($channel);

        $useCase = new SendNotificationUseCase($resolver);

        $report = $useCase->execute(NotificationChannelNameEnum::TELEGRAM, '123456789', $message);

        $this->assertFalse($report->isSuccessful());
    }
}
