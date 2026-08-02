<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Application\Watcher\Ports\DomainEventDispatcherInterface;
use App\Domain\Watcher\Events\CheckFailedEvent;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use DateTimeImmutable;

/**
 * Reacts to a failed availability check from node-worker: marks the WatchTask FAILED (terminal —
 * see WatchTask::fail()) and raises CheckFailedEvent. Retry/backoff semantics for transient vs.
 * hard failures are Phase 8's concern (see docs/APPLICATION_ROADMAP.md); every failure is terminal
 * for now.
 */
final readonly class HandleCheckFailedUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
        private DomainEventDispatcherInterface $events,
    ) {}

    public function execute(int $watchTaskId, string $reason, DateTimeImmutable $occurredAt): void
    {
        $watchTask = $this->repository->find($watchTaskId);

        if (null === $watchTask) {
            throw WatchTaskNotFoundException::withId($watchTaskId);
        }

        $watchTask->fail();
        $this->repository->save($watchTask);

        $this->events->dispatch(new CheckFailedEvent(
            watchTaskId: $watchTaskId,
            reason: $reason,
            occurredAt: $occurredAt,
        ));
    }
}
