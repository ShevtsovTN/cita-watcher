<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Notification\Channels;

use App\Domain\Notification\ValueObjects\NotificationMessage;
use App\Infrastructure\Notification\Channels\MailNotificationChannel;
use Illuminate\Contracts\Mail\Mailer;
use Illuminate\Mail\Message;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class MailNotificationChannelTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_returns_delivered_report_when_mailer_sends_successfully(): void
    {
        $mailer = Mockery::mock(Mailer::class);
        $mailer->shouldReceive('raw')
            ->once()
            ->with('Slots found', Mockery::type('callable'))
            ->andReturnUsing(function (string $text, callable $callback): void {
                $message = Mockery::mock(Message::class);
                $message->shouldReceive('to')->once()->with('user@example.com');
                $callback($message);
            });

        $channel = new MailNotificationChannel($mailer);

        $report = $channel->send('user@example.com', new NotificationMessage('Slots found'));

        $this->assertTrue($report->isSuccessful());
        $this->assertSame('mail', $report->getChannel());
        $this->assertSame('user@example.com', $report->getTarget());
        $this->assertNotNull($report->getDeliveredAt());
    }

    public function test_it_returns_failed_report_without_throwing_when_mailer_fails(): void
    {
        $mailer = Mockery::mock(Mailer::class);
        $mailer->shouldReceive('raw')
            ->once()
            ->andThrow(new RuntimeException('SMTP connection refused'));

        $channel = new MailNotificationChannel($mailer);

        $report = $channel->send('user@example.com', new NotificationMessage('Slots found'));

        $this->assertFalse($report->isSuccessful());
        $this->assertSame('SMTP connection refused', $report->getError()->getMessage());
        $this->assertTrue($report->getError()->isRetryable());
    }
}
