<?php

declare(strict_types=1);

namespace App\Infrastructure\Providers;

use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Infrastructure\Watcher\Persistence\EloquentWatchTaskRepository;
use Illuminate\Support\ServiceProvider;

class WatcherServiceProvider extends ServiceProvider
{
    /**
     * Register services.
     */
    public function register(): void
    {
        $this->app->bind(WatchTaskRepositoryInterface::class, EloquentWatchTaskRepository::class);
    }

    /**
     * Bootstrap services.
     */
    public function boot(): void
    {
        //
    }
}
