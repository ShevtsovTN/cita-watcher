<?php

declare(strict_types=1);

namespace App\Infrastructure\Providers;

use App\Application\Watcher\Listeners\SendNotificationOnCheckFailedListener;
use App\Application\Watcher\Listeners\SendNotificationOnSlotsFoundListener;
use App\Application\Watcher\Ports\ApplicantDataEncryptorInterface;
use App\Application\Watcher\Ports\DomainEventDispatcherInterface;
use App\Application\Watcher\Ports\WorkerGatewayInterface;
use App\Application\Watcher\UseCases\FindWatchTasksDueForCheckUseCase;
use App\Domain\Watcher\Events\CheckFailedEvent;
use App\Domain\Watcher\Events\SlotsFoundEvent;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Infrastructure\Watcher\Encryption\LaravelApplicantDataEncryptor;
use App\Infrastructure\Watcher\Events\IlluminateDomainEventDispatcher;
use App\Infrastructure\Watcher\Messaging\RedisWorkerGateway;
use App\Infrastructure\Watcher\Persistence\EloquentWatchTaskRepository;
use Illuminate\Contracts\Foundation\Application;
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
        $this->app->bind(DomainEventDispatcherInterface::class, IlluminateDomainEventDispatcher::class);
        $this->app->bind(ApplicantDataEncryptorInterface::class, LaravelApplicantDataEncryptor::class);

        $this->app->bind(FindWatchTasksDueForCheckUseCase::class, function (Application $app): FindWatchTasksDueForCheckUseCase {
            return new FindWatchTasksDueForCheckUseCase(
                $app->make(WatchTaskRepositoryInterface::class),
                (int) config('services.node_worker.max_concurrent_sessions'),
            );
        });
    }

    /**
     * Bootstrap services.
     */
    public function boot(): void
    {
        Event::listen(SlotsFoundEvent::class, SendNotificationOnSlotsFoundListener::class);
        Event::listen(CheckFailedEvent::class, SendNotificationOnCheckFailedListener::class);
    }
}
