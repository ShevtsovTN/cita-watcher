<?php

declare(strict_types=1);

namespace App\Application\Watcher\Listeners;

use App\Application\Notification\UseCases\SendNotificationUseCase;
use App\Application\Watcher\Ports\CaptchaSessionUrlBuilderInterface;
use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Events\CaptchaInterventionRequiredEvent;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;

/**
 * Reacts to CaptchaInterventionRequiredEvent by telling a human, through the WatchTask's
 * configured channel, the URL where they can reach the paused CDP screencast relay session and
 * solve the captcha by hand — same cross-context enum translation as
 * SendNotificationOnSlotsFoundListener/SendNotificationOnCheckFailedListener. The event only
 * carries a bare sessionToken (see docs/NODE_WORKER_ROADMAP.md Phase 7 — node-worker deliberately
 * doesn't know Laravel's public URL), so building the actual link is this listener's job via
 * CaptchaSessionUrlBuilderInterface.
 */
final readonly class NotifyOnCaptchaInterventionRequiredListener
{
    public function __construct(
        private WatchTaskRepositoryInterface $watchTaskRepository,
        private CaptchaSessionUrlBuilderInterface $urlBuilder,
        private SendNotificationUseCase $sendNotificationUseCase,
    ) {}

    public function handle(CaptchaInterventionRequiredEvent $event): void
    {
        $watchTask = $this->watchTaskRepository->find($event->watchTaskId);

        if (null === $watchTask) {
            return;
        }

        $url = $this->urlBuilder->build($event->sessionToken);

        $this->sendNotificationUseCase->execute(
            $this->toNotificationChannel($watchTask->notificationChannel()),
            $watchTask->notificationTarget(),
            new NotificationMessage(sprintf('A captcha needs solving to continue your watch: %s', $url)),
        );
    }

    private function toNotificationChannel(WatchTaskNotificationChannelEnum $channel): NotificationChannelNameEnum
    {
        return match ($channel) {
            WatchTaskNotificationChannelEnum::MAIL => NotificationChannelNameEnum::MAIL,
            WatchTaskNotificationChannelEnum::TELEGRAM => NotificationChannelNameEnum::TELEGRAM,
        };
    }
}
