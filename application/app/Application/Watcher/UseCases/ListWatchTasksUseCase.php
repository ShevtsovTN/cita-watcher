<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\WatchTask;

final readonly class ListWatchTasksUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
    ) {}

    /**
     * @return list<WatchTask>
     */
    public function execute(int $requestingUserId): array
    {
        return $this->repository->findByUserId($requestingUserId);
    }
}
