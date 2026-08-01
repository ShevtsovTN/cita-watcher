<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Watcher\Enums;

use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class WatchTaskStatusEnumTest extends TestCase
{
    public function test_it_exposes_the_expected_backing_values(): void
    {
        $this->assertSame('pending', WatchTaskStatusEnum::PENDING->value);
        $this->assertSame('running', WatchTaskStatusEnum::RUNNING->value);
        $this->assertSame('paused', WatchTaskStatusEnum::PAUSED->value);
        $this->assertSame('completed', WatchTaskStatusEnum::COMPLETED->value);
        $this->assertSame('failed', WatchTaskStatusEnum::FAILED->value);
    }

    #[DataProvider('statuses')]
    public function test_is_terminal(WatchTaskStatusEnum $status, bool $expectedTerminal): void
    {
        $this->assertSame($expectedTerminal, $status->isTerminal());
    }

    public static function statuses(): array
    {
        return [
            'pending' => [WatchTaskStatusEnum::PENDING, false],
            'running' => [WatchTaskStatusEnum::RUNNING, false],
            'paused' => [WatchTaskStatusEnum::PAUSED, false],
            'completed' => [WatchTaskStatusEnum::COMPLETED, true],
            'failed' => [WatchTaskStatusEnum::FAILED, true],
        ];
    }
}
