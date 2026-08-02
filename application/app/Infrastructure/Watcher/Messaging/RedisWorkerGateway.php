<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Messaging;

use App\Application\Watcher\Ports\WorkerGatewayInterface;
use App\Domain\Watcher\WatchTask;
use Illuminate\Contracts\Redis\Factory as RedisFactory;
use Illuminate\Log\LogManager;

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
 *
 * Logs with `watch_task_id`/`command_id` context (Phase 8) purely for correlation — grepping one
 * WatchTask's or one command's journey across this log and, eventually, node-worker's own logs
 * (see docs/NODE_WORKER_ROADMAP.md Phase 5). Nothing here verifies the `commandId` round-trips.
 */
final readonly class RedisWorkerGateway implements WorkerGatewayInterface
{
    private const string COMMANDS_LIST = 'watcher-commands';

    public function __construct(
        private RedisFactory $redis,
        private LogManager $log,
    ) {}

    public function dispatchAvailabilityCheck(WatchTask $watchTask): void
    {
        $command = WorkerCommand::forAvailabilityCheck($watchTask);

        $this->log->withContext([
            'watch_task_id' => $watchTask->id(),
            'command_id' => $command->commandId,
        ]);

        $this->redis->connection()->rpush(
            self::COMMANDS_LIST,
            json_encode($command->toArray(), JSON_THROW_ON_ERROR),
        );

        $this->log->info('Dispatched availability check command to node-worker.');
    }
}
