<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Repository;

use App\Domain\Watcher\WatchTask;

interface WatchTaskRepositoryInterface
{
    public function find(int $id): ?WatchTask;

    /**
     * Persists the given WatchTask and returns the persisted instance — callers need this to
     * observe an id assigned by storage for a not-yet-persisted WatchTask (its id is readonly and
     * cannot be set after construction).
     */
    public function save(WatchTask $watchTask): WatchTask;

    public function delete(WatchTask $watchTask): void;
}
