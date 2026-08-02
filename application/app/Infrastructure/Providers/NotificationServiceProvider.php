<?php

declare(strict_types=1);

namespace App\Infrastructure\Providers;

use App\Application\Notification\Ports\NotificationChannelResolverInterface;
use App\Infrastructure\Notification\Channels\TelegramNotificationChannel;
use App\Infrastructure\Notification\NotificationChannelResolver;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\ServiceProvider;

class NotificationServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     */
    public function register(): void
    {
        $this->app->bind(TelegramNotificationChannel::class, function (Application $app): TelegramNotificationChannel {
            return new TelegramNotificationChannel(
                $app->make(HttpFactory::class),
                (string) config('services.telegram.bot_token'),
            );
        });

        $this->app->bind(NotificationChannelResolverInterface::class, NotificationChannelResolver::class);
    }

    /**
     * Bootstrap services.
     */
    public function boot(): void {}
}
