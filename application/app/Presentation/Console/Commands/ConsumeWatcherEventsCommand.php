<?php

declare(strict_types=1);

namespace App\Presentation\Console\Commands;

use App\Infrastructure\Watcher\Messaging\WorkerEventRouter;
use Illuminate\Console\Command;
use Illuminate\Contracts\Redis\Factory as RedisFactory;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Long-running consumer: subscribes to the `watcher-events` Redis channel and delegates each
 * message to WorkerEventRouter. Deliberately thin — deserialization and use-case dispatch live in
 * the router so they're unit-testable; Redis::subscribe() itself blocks forever and isn't
 * exercised by tests, the same way queue:work's loop isn't.
 *
 * A single malformed/unexpected message must not take the whole consumer down (there's no queue
 * retry mechanism for pub/sub the way there is for the `watcher-commands` queue), so each message
 * is handled in its own try/catch and logged rather than left to bubble up.
 */
final class ConsumeWatcherEventsCommand extends Command
{
    private const string CHANNEL = 'watcher-events';

    protected $signature = 'watcher:consume-events';

    protected $description = 'Subscribe to the watcher-events Redis channel and react to node-worker check results.';

    public function handle(RedisFactory $redis, WorkerEventRouter $router): int
    {
        $this->info(sprintf('Listening on the "%s" Redis channel...', self::CHANNEL));

        $redis->connection()->subscribe(
            [self::CHANNEL],
            fn(string $payload) => $this->handleMessage($payload, $router),
        );

        return self::SUCCESS;
    }

    /**
     * Extracted from handle()'s subscribe callback so it's callable directly in tests without a
     * real Redis connection — Redis::subscribe() itself blocks forever and can't be driven by a
     * test the way this method can.
     */
    public function handleMessage(string $payload, WorkerEventRouter $router): void
    {
        try {
            $router->route($payload);
        } catch (Throwable $exception) {
            Log::error('watcher:consume-events failed to handle a message', [
                'exception' => $exception,
                'payload' => $payload,
            ]);
        }
    }
}
