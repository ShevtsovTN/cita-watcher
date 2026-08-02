<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\WatchTask;

/**
 * Ownership-checked single-WatchTask lookup, backing the Presentation layer's "show" endpoint —
 * kept as its own use case (rather than a direct repository call from the controller) so every
 * controller action goes through Application, none reach into Domain/Infrastructure directly.
 */
final readonly class GetWatchTaskUseCase
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

        return $watchTask;
    }
}
