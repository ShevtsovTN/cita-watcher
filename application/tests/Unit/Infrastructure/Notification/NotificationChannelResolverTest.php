<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Notification;

use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Infrastructure\Notification\Channels\MailNotificationChannel;
use App\Infrastructure\Notification\Channels\TelegramNotificationChannel;
use App\Infrastructure\Notification\NotificationChannelResolver;
use Illuminate\Contracts\Mail\Mailer;
use Illuminate\Http\Client\Factory as HttpFactory;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class NotificationChannelResolverTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_resolves_the_mail_channel(): void
    {
        [$mailChannel, $telegramChannel, $resolver] = $this->makeResolver();

        $this->assertSame($mailChannel, $resolver->resolve(NotificationChannelNameEnum::MAIL));
    }

    public function test_it_resolves_the_telegram_channel(): void
    {
        [$mailChannel, $telegramChannel, $resolver] = $this->makeResolver();

        $this->assertSame($telegramChannel, $resolver->resolve(NotificationChannelNameEnum::TELEGRAM));
    }

    /**
     * @return array{0: MailNotificationChannel, 1: TelegramNotificationChannel, 2: NotificationChannelResolver}
     */
    private function makeResolver(): array
    {
        $mailChannel = new MailNotificationChannel(Mockery::mock(Mailer::class));
        $telegramChannel = new TelegramNotificationChannel(new HttpFactory, 'test-bot-token');

        return [$mailChannel, $telegramChannel, new NotificationChannelResolver($mailChannel, $telegramChannel)];
    }
}
