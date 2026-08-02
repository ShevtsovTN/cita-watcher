<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\WatchTask;

final readonly class PauseWatchTaskUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
    ) {}

    public function execute(int $watchTaskId, int $requestingUserId): WatchTask
    {
        $watchTask = $this->repository->find($watchTaskId);

        if (null === $watchTask || $watchTask->userId() !== $requestingUserId) {
            throw WatchTaskNotFoundException::withId($watchTaskId);
        }

        $watchTask->pause();

        return $this->repository->save($watchTask);
    }
}
