<?php

declare(strict_types=1);

namespace App\Infrastructure\Providers;

use App\Application\Watcher\Listeners\SendNotificationOnSlotsFoundListener;
use App\Application\Watcher\Ports\WorkerGatewayInterface;
use App\Domain\Watcher\Events\SlotsFoundEvent;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Infrastructure\Watcher\Messaging\RedisWorkerGateway;
use App\Infrastructure\Watcher\Persistence\EloquentWatchTaskRepository;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

class WatcherServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     */
    public function register(): void
    {
        $this->app->bind(WatchTaskRepositoryInterface::class, EloquentWatchTaskRepository::class);
        $this->app->bind(WorkerGatewayInterface::class, RedisWorkerGateway::class);
    }

    /**
     * Bootstrap services.
     */
    public function boot(): void
    {
        Event::listen(SlotsFoundEvent::class, SendNotificationOnSlotsFoundListener::class);
    }
}
