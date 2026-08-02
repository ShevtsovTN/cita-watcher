<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;

final readonly class DeleteWatchTaskUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
    ) {}

    public function execute(int $watchTaskId, int $requestingUserId): void
    {
        $watchTask = $this->repository->find($watchTaskId);

        if (null === $watchTask || $watchTask->userId() !== $requestingUserId) {
            throw WatchTaskNotFoundException::withId($watchTaskId);
        }

        $this->repository->delete($watchTask);
    }
}
