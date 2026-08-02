<?php

declare(strict_types=1);

namespace App\Presentation\Jobs;

use App\Application\Watcher\UseCases\DispatchAvailabilityCheckUseCase;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Log\LogManager;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * Dispatched onto the `watcher-commands` Laravel queue so that `queue-worker`
 * (php artisan queue:work redis --queue=watcher-commands) — the only queue worker
 * docker-compose.yml defines — is the process that runs it. handle() then invokes
 * DispatchAvailabilityCheckUseCase, whose WorkerGatewayInterface (RedisWorkerGateway) is what
 * actually notifies node-worker, via a separate raw Redis list of the same name — see
 * RedisWorkerGateway's docblock for why the two don't collide.
 */
final class DispatchAvailabilityCheckJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const string QUEUE = 'watcher-commands';

    public function __construct(
        public readonly int $watchTaskId,
    ) {
        $this->onQueue(self::QUEUE);
    }

    public function handle(DispatchAvailabilityCheckUseCase $useCase, LogManager $log): void
    {
        $log->withContext(['watch_task_id' => $this->watchTaskId]);

        $useCase->execute($this->watchTaskId);
    }
}
