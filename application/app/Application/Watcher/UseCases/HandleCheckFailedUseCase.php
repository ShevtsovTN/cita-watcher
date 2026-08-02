<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Application\Watcher\Ports\DomainEventDispatcherInterface;
use App\Domain\Watcher\Events\CheckFailedEvent;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use DateTimeImmutable;

/**
 * Reacts to a failed availability check from node-worker. node-worker decides whether the failure
 * is retryable (a transient network/site error) or terminal (e.g. an invalid procedure that will
 * never succeed) — see CheckFailedEvent::$retryable. Retryable sends the WatchTask back to PENDING
 * (WatchTask::retry()) for another scheduled attempt; otherwise it's terminal (WatchTask::fail()).
 * CheckFailedEvent is raised either way — SendNotificationOnCheckFailedListener is the one that
 * decides whether a retryable failure is worth bothering the user about.
 */
final readonly class HandleCheckFailedUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
        private DomainEventDispatcherInterface $events,
    ) {}

    public function execute(int $watchTaskId, string $reason, bool $retryable, DateTimeImmutable $occurredAt): void
    {
        $watchTask = $this->repository->find($watchTaskId);

        if (null === $watchTask) {
            throw WatchTaskNotFoundException::withId($watchTaskId);
        }

        if ($retryable) {
            $watchTask->retry();
        } else {
            $watchTask->fail();
        }

        $this->repository->save($watchTask);

        $this->events->dispatch(new CheckFailedEvent(
            watchTaskId: $watchTaskId,
            reason: $reason,
            retryable: $retryable,
            occurredAt: $occurredAt,
        ));
    }
}
