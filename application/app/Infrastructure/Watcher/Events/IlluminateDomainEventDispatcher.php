<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Events;

use App\Application\Watcher\Ports\DomainEventDispatcherInterface;
use Illuminate\Contracts\Events\Dispatcher;

final readonly class IlluminateDomainEventDispatcher implements DomainEventDispatcherInterface
{
    public function __construct(
        private Dispatcher $events,
    ) {}

    public function dispatch(object $event): void
    {
        $this->events->dispatch($event);
    }
}
