<?php

declare(strict_types=1);

namespace App\Application\Watcher\Ports;

/**
 * Narrow port: only knows how to dispatch a domain event to whatever listeners are registered
 * for it. Lets use cases raise Domain\Watcher\Events\* without depending on Illuminate's event
 * facade/contract directly.
 */
interface DomainEventDispatcherInterface
{
    public function dispatch(object $event): void;
}
