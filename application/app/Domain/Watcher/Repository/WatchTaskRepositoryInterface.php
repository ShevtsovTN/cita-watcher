<?php

declare(strict_types=1);

namespace App\Domain\Watcher\Repository;

use App\Domain\Watcher\WatchTask;

interface WatchTaskRepositoryInterface
{
    public function find(int $id): ?WatchTask;

    public function save(WatchTask $watchTask): void;

    public function delete(WatchTask $watchTask): void;
}
