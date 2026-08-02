<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Messaging;

use App\Application\Watcher\UseCases\HandleCaptchaRequiredUseCase;
use App\Application\Watcher\UseCases\HandleCheckCompletedUseCase;
use App\Application\Watcher\UseCases\HandleCheckFailedUseCase;
use App\Domain\Watcher\ValueObjects\AppointmentSlot;
use App\Domain\Watcher\ValueObjects\CheckResult;
use DateTimeImmutable;
use InvalidArgumentException;

/**
 * Decodes a single message received on the `watcher-events` Redis channel and delegates to the
 * matching Handle*UseCase, based on the `type` discriminator — the inbound counterpart to
 * WorkerCommand's outbound `type` field. Shape must stay in sync with whatever node-worker's
 * messaging module publishes; see ../../../../../docs/NODE_WORKER_ROADMAP.md Phase 3, not yet
 * implemented there either.
 */
final readonly class WorkerEventRouter
{
    public function __construct(
        private HandleCheckCompletedUseCase $handleCheckCompleted,
        private HandleCaptchaRequiredUseCase $handleCaptchaRequired,
        private HandleCheckFailedUseCase $handleCheckFailed,
    ) {}

    public function route(string $payload): void
    {
        $data = json_decode($payload, true, flags: JSON_THROW_ON_ERROR);

        match ($data['type'] ?? null) {
            'check_completed' => $this->routeCheckCompleted($data),
            'captcha_required' => $this->routeCaptchaRequired($data),
            'check_failed' => $this->routeCheckFailed($data),
            default => throw new InvalidArgumentException(
                sprintf('Unknown worker event type: %s', var_export($data['type'] ?? null, true)),
            ),
        };
    }

    /**
     * @param array{watchTaskId: int, slots: list<array{dateTime: string, office: string}>, checkedAt: string} $data
     */
    private function routeCheckCompleted(array $data): void
    {
        $slots = array_map(
            static fn(array $slot): AppointmentSlot => new AppointmentSlot(
                new DateTimeImmutable($slot['dateTime']),
                $slot['office'],
            ),
            $data['slots'],
        );

        $this->handleCheckCompleted->execute(
            $data['watchTaskId'],
            new CheckResult(slots: $slots, checkedAt: new DateTimeImmutable($data['checkedAt'])),
        );
    }

    /**
     * @param array{watchTaskId: int, occurredAt: string} $data
     */
    private function routeCaptchaRequired(array $data): void
    {
        $this->handleCaptchaRequired->execute($data['watchTaskId'], new DateTimeImmutable($data['occurredAt']));
    }

    /**
     * @param array{watchTaskId: int, reason: string, retryable: bool, occurredAt: string} $data
     */
    private function routeCheckFailed(array $data): void
    {
        $this->handleCheckFailed->execute(
            $data['watchTaskId'],
            $data['reason'],
            $data['retryable'],
            new DateTimeImmutable($data['occurredAt']),
        );
    }
}
