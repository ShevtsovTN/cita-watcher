<?php

declare(strict_types=1);

namespace Tests\Unit\Application\Watcher\Listeners;

use App\Application\Notification\Ports\NotificationChannelInterface;
use App\Application\Notification\Ports\NotificationChannelResolverInterface;
use App\Application\Notification\UseCases\SendNotificationUseCase;
use App\Application\Watcher\Listeners\SendNotificationOnCheckFailedListener;
use App\Domain\Notification\Enums\DeliveryStatusEnum;
use App\Domain\Notification\Enums\NotificationChannelNameEnum;
use App\Domain\Notification\ValueObjects\NotificationDeliveryReport;
use App\Domain\Notification\ValueObjects\NotificationMessage;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Events\CheckFailedEvent;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use DateTimeImmutable;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class SendNotificationOnCheckFailedListenerTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_notifies_through_the_watch_tasks_configured_channel(): void
    {
        $watchTask = $this->makeWatchTask();

        $event = new CheckFailedEvent(watchTaskId: 42, reason: 'site unreachable', occurredAt: new DateTimeImmutable());

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(42)->andReturn($watchTask);

        $channel = Mockery::mock(NotificationChannelInterface::class);
        $channel->shouldReceive('send')
            ->once()
            ->with('123456789', Mockery::on(function (NotificationMessage $message): bool {
                return str_contains($message->text, 'site unreachable')
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

        $listener = new SendNotificationOnCheckFailedListener($repository, new SendNotificationUseCase($resolver));

        $listener->handle($event);
    }

    public function test_it_does_nothing_when_the_watch_task_no_longer_exists(): void
    {
        $event = new CheckFailedEvent(watchTaskId: 99, reason: 'boom', occurredAt: new DateTimeImmutable());

        $repository = Mockery::mock(WatchTaskRepositoryInterface::class);
        $repository->shouldReceive('find')->once()->with(99)->andReturn(null);

        $resolver = Mockery::mock(NotificationChannelResolverInterface::class);
        $resolver->shouldNotReceive('resolve');

        $listener = new SendNotificationOnCheckFailedListener($repository, new SendNotificationUseCase($resolver));

        $listener->handle($event);
    }

    private function makeWatchTask(): WatchTask
    {
        return new WatchTask(
            id: 42,
            userId: 7,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
