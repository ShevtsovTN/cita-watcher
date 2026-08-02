<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Application\Watcher\Ports\WorkerGatewayInterface;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;

/**
 * Dispatches an availability check command to node-worker for a single WatchTask. Dispatch only —
 * it does not send notifications or write logs itself; those are separate listeners/use cases.
 */
final readonly class DispatchAvailabilityCheckUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
        private WorkerGatewayInterface $workerGateway,
    ) {}

    public function execute(int $watchTaskId): void
    {
        $watchTask = $this->repository->find($watchTaskId);

        if (null === $watchTask) {
            throw WatchTaskNotFoundException::withId($watchTaskId);
        }

        $this->workerGateway->dispatchAvailabilityCheck($watchTask);

        $watchTask->start();

        $this->repository->save($watchTask);
    }
}
