<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Application\Watcher\Ports\DomainEventDispatcherInterface;
use App\Domain\Watcher\Events\SlotsFoundEvent;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\CheckResult;

/**
 * Reacts to a completed availability check from node-worker. Slots found is terminal
 * (WatchTask::complete()) and raises SlotsFoundEvent for notification listeners; no slots found
 * sends the WatchTask back to PENDING (WatchTask::recheck()) so the next scheduled dispatch
 * (DispatchDueAvailabilityChecksCommand) picks it up again.
 */
final readonly class HandleCheckCompletedUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
        private DomainEventDispatcherInterface $events,
    ) {}

    public function execute(int $watchTaskId, CheckResult $result): void
    {
        $watchTask = $this->repository->find($watchTaskId);

        if (null === $watchTask) {
            throw WatchTaskNotFoundException::withId($watchTaskId);
        }

        if ($result->slotsFound()) {
            $watchTask->complete();
            $this->repository->save($watchTask);

            $this->events->dispatch(new SlotsFoundEvent(
                watchTaskId: $watchTaskId,
                slots: $result->slots,
                occurredAt: $result->checkedAt,
            ));

            return;
        }

        $watchTask->recheck();
        $this->repository->save($watchTask);
    }
}
