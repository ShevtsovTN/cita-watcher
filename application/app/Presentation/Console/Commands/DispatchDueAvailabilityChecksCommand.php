<?php

declare(strict_types=1);

namespace App\Presentation\Console\Commands;

use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Presentation\Jobs\DispatchAvailabilityCheckJob;
use Illuminate\Console\Command;

final class DispatchDueAvailabilityChecksCommand extends Command
{
    protected $signature = 'watcher:dispatch-due-checks';

    protected $description = 'Enqueue an availability check for every pending WatchTask.';

    public function handle(WatchTaskRepositoryInterface $repository): int
    {
        foreach ($repository->findPending() as $watchTask) {
            DispatchAvailabilityCheckJob::dispatch((int) $watchTask->id());
        }

        return self::SUCCESS;
    }
}
