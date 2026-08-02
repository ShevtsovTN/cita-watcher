<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Messaging;

use App\Application\Watcher\Ports\WorkerGatewayInterface;
use App\Domain\Watcher\WatchTask;
use Illuminate\Contracts\Redis\Factory as RedisFactory;

/**
 * Publishes availability-check commands by RPUSHing a plain JSON WorkerCommand payload onto the
 * `watcher-commands` Redis list — the same name `queue-worker`
 * (php artisan queue:work redis --queue=watcher-commands) listens on per docker-compose.yml.
 *
 * This deliberately bypasses Laravel's own queue system: Laravel's redis queue driver stores its
 * jobs under a `queues:`-prefixed key (e.g. `queues:watcher-commands`), so a raw RPUSH here to the
 * bare `watcher-commands` key never collides with it. node-worker (not a Laravel/PHP process) can
 * read this list directly with a plain BRPOP once its messaging module exists, without needing to
 * understand Laravel's job serialization format.
 */
final readonly class RedisWorkerGateway implements WorkerGatewayInterface
{
    private const string COMMANDS_LIST = 'watcher-commands';

    public function __construct(
        private RedisFactory $redis,
    ) {}

    public function dispatchAvailabilityCheck(WatchTask $watchTask): void
    {
        $command = WorkerCommand::forAvailabilityCheck($watchTask);

        $this->redis->connection()->rpush(
            self::COMMANDS_LIST,
            json_encode($command->toArray(), JSON_THROW_ON_ERROR),
        );
    }
}
