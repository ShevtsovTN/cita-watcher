<?php

declare(strict_types=1);

namespace App\Presentation\Console\Commands;

use App\Application\Watcher\UseCases\FindWatchTasksDueForCheckUseCase;
use App\Presentation\Jobs\DispatchAvailabilityCheckJob;
use Illuminate\Console\Command;

final class DispatchDueAvailabilityChecksCommand extends Command
{
    protected $signature = 'watcher:dispatch-due-checks';

    protected $description = 'Enqueue an availability check for every pending WatchTask, capped by node-worker\'s concurrency limit.';

    public function handle(FindWatchTasksDueForCheckUseCase $findDueWatchTasks): int
    {
        foreach ($findDueWatchTasks->execute() as $watchTask) {
            DispatchAvailabilityCheckJob::dispatch((int) $watchTask->id());
        }

        return self::SUCCESS;
    }
}
