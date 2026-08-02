<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Watcher\Events;

use App\Infrastructure\Watcher\Events\IlluminateDomainEventDispatcher;
use Illuminate\Contracts\Events\Dispatcher;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;
use stdClass;

final class IlluminateDomainEventDispatcherTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_delegates_to_the_illuminate_event_dispatcher(): void
    {
        $event = new stdClass();

        $events = Mockery::mock(Dispatcher::class);
        $events->shouldReceive('dispatch')->once()->with($event);

        $dispatcher = new IlluminateDomainEventDispatcher($events);

        $dispatcher->dispatch($event);
    }
}
