<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\Listeners;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Application\Notification\Ports\NotificationChannelInterface;
use App\Application\Notification\Ports\NotificationChannelResolverInterface;
use App\Application\Notification\UseCases\SendNotificationUseCase;
use App\Application\Watcher\Listeners\SendNotificationOnSlotsFoundListener;
use App\Domain\Notification\Enums\DeliveryStatusEnum;
use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Domain\Notification\ValueObjects\NotificationDeliveryReport;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Events\SlotsFoundEvent;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\AppointmentSlot;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use DateTimeImmutable;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class SendNotificationOnSlotsFoundListenerTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_maps_the_watch_task_channel_and_sends_a_notification(): void
    {
        $watchTask = $this->makeWatchTask(WatchTaskNotificationChannelEnum::TELEGRAM, '123456789');

        $slot = new AppointmentSlot(new DateTimeImmutable('2026-08-10 10:00'), 'Madrid Office');
        $event = new SlotsFoundEvent(watchTaskId: 42, slots: [$slot], occurredAt: new DateTimeImmutable());

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);

        $channel = Mockery::mock(NotificationChannelInterface::class);
        $channel->shouldReceive('send')
            ->once()
            ->with('123456789', Mockery::on(function (NotificationMessage $message): bool {
                return str_contains($message->text, 'Madrid Office')
                    && ! str_contains($message->text, 'Juan Pérez')
                    && ! str_contains($message->text, '12345678A')
                    && ! str_contains($message->text, 'juan@example.com');
            }))
            ->andReturn(new NotificationDeliveryReport(channel: 'telegram', target: '123456789', status: DeliveryStatusEnum::DELIVERED));

        $resolver = Mockery::mock(NotificationChannelResolverInterface::class);
        $resolver->shouldReceive('resolve')
            ->once()
            ->with(NotificationChannelNameEnum::TELEGRAM)
            ->andReturn($channel);

        $listener = new SendNotificationOnSlotsFoundListener($repository, new SendNotificationUseCase($resolver));

        $listener->handle($event);
    }

    public function test_it_does_nothing_when_the_watch_task_no_longer_exists(): void
    {
        $event = new SlotsFoundEvent(watchTaskId: 99, slots: [], occurredAt: new DateTimeImmutable());

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(99)->andReturn(null);

        $resolver = Mockery::mock(NotificationChannelResolverInterface::class);
        $resolver->shouldNotReceive('resolve');

        $listener = new SendNotificationOnSlotsFoundListener($repository, new SendNotificationUseCase($resolver));

        $listener->handle($event);
    }

    private function makeWatchTask(WatchTaskNotificationChannelEnum $channel, string $target): WatchTask
    {
        return new WatchTask(
            id: 42,
            userId: 7,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com', documentType: DocumentTypeEnum::DNI, birthYear: 1990, nationality: 'España'),
            notificationChannel: $channel,
            notificationTarget: $target,
        );
    }
}
