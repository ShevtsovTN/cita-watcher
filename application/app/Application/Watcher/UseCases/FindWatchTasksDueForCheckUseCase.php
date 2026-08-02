<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\WatchTask;

/**
 * Caps how many pending WatchTasks are due for a check right now, so
 * DispatchDueAvailabilityChecksCommand never enqueues more concurrent checks than node-worker's
 * own maxConcurrentSessions can handle. RUNNING WatchTasks are checks already dispatched with no
 * result back yet — see WatchTaskRepositoryInterface::countRunning().
 */
final readonly class FindWatchTasksDueForCheckUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
        private int $maxConcurrentSessions,
    ) {}

    /**
     * @return list<WatchTask>
     */
    public function execute(): array
    {
        $availableSlots = max(0, $this->maxConcurrentSessions - $this->repository->countRunning());

        return array_slice($this->repository->findPending(), 0, $availableSlots);
    }
}
