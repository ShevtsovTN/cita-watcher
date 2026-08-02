<?php

declare(strict_types=1);

namespace Tests\Feature\Notification;

use App\Application\Notification\Ports\NotificationChannelResolverInterface;
use App\Application\Notification\UseCases\SendNotificationUseCase;
use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use App\Infrastructure\Notification\Channels\MailNotificationChannel;
use App\Infrastructure\Notification\Channels\TelegramNotificationChannel;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

final class NotificationServiceProviderTest extends TestCase
{
    public function test_container_resolves_the_mail_channel_through_the_resolver(): void
    {
        $resolver = $this->app->make(NotificationChannelResolverInterface::class);

        $channel = $resolver->resolve(NotificationChannelNameEnum::MAIL);

        $this->assertInstanceOf(MailNotificationChannel::class, $channel);
    }

    public function test_container_resolves_the_telegram_channel_wired_with_the_configured_bot_token(): void
    {
        config(['services.telegram.bot_token' => 'test-bot-token']);
        Http::fake([
            'api.telegram.org/*' => Http::response(['ok' => true, 'result' => ['message_id' => 1]], 200),
        ]);

        $resolver = $this->app->make(NotificationChannelResolverInterface::class);
        $channel = $resolver->resolve(NotificationChannelNameEnum::TELEGRAM);

        $this->assertInstanceOf(TelegramNotificationChannel::class, $channel);

        $channel->send('123456789', new NotificationMessage('Slots found'));

        Http::assertSent(function ($request): bool {
            return 'https://api.telegram.org/bottest-bot-token/sendMessage' === $request->url();
        });
    }

    public function test_send_notification_use_case_is_resolvable_and_delivers_through_the_container(): void
    {
        Http::fake([
            'api.telegram.org/*' => Http::response(['ok' => true, 'result' => ['message_id' => 1]], 200),
        ]);

        $useCase = $this->app->make(SendNotificationUseCase::class);

        $report = $useCase->execute(NotificationChannelNameEnum::TELEGRAM, '123456789', new NotificationMessage('Slots found'));

        $this->assertTrue($report->isSuccessful());
    }
}
