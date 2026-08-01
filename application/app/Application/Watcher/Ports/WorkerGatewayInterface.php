<?php

declare(strict_types=1);

namespace App\Application\Watcher\Ports;

use App\Domain\Watcher\WatchTask;

/**
 * Narrow port: only knows how to send an availability-check command to node-worker. It does not
 * expose repository-style query methods — that's WatchTaskRepositoryInterface's job.
 */
interface WorkerGatewayInterface
{
    public function dispatchAvailabilityCheck(WatchTask $watchTask): void;
}
