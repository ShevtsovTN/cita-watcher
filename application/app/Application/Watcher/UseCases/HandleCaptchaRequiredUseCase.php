<?php

declare(strict_types=1);

namespace App\Application\Watcher\UseCases;

use App\Application\Watcher\Ports\DomainEventDispatcherInterface;
use App\Domain\Watcher\Events\CaptchaInterventionRequiredEvent;
use App\Domain\Watcher\Exceptions\WatchTaskNotFoundException;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use DateTimeImmutable;

/**
 * Reacts to node-worker hitting a captcha. Doesn't change WatchTask state — the manual
 * captcha-solving UX (via the CDP screencast relay) isn't designed yet (see
 * ../../../../../docs/APPLICATION_ROADMAP.md Phase 9), so for now this only surfaces the event to
 * whichever listeners react to it.
 */
final readonly class HandleCaptchaRequiredUseCase
{
    public function __construct(
        private WatchTaskRepositoryInterface $repository,
        private DomainEventDispatcherInterface $events,
    ) {}

    public function execute(int $watchTaskId, string $sessionToken, DateTimeImmutable $occurredAt): void
    {
        $watchTask = $this->repository->find($watchTaskId);

        if (null === $watchTask) {
            throw WatchTaskNotFoundException::withId($watchTaskId);
        }

        $this->events->dispatch(new CaptchaInterventionRequiredEvent(
            watchTaskId: $watchTaskId,
            sessionToken: $sessionToken,
            occurredAt: $occurredAt,
        ));
    }
}
