<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Watcher\Messaging;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Watcher\Messaging\RedisWorkerGateway;
use Illuminate\Contracts\Redis\Factory as RedisFactory;
use Illuminate\Log\LogManager;
use Illuminate\Redis\Connections\Connection;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use PHPUnit\Framework\TestCase;

final class RedisWorkerGatewayTest extends TestCase
{
    use MockeryPHPUnitIntegration;

    public function test_it_pushes_the_worker_command_json_onto_the_watcher_commands_list(): void
    {
        $watchTask = new WatchTask(
            id: 42,
            userId: 7,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com', documentType: DocumentTypeEnum::DNI, birthYear: 1990, nationality: 'España'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );

        $connection = Mockery::mock(Connection::class);
        $connection->shouldReceive('rpush')
            ->once()
            ->with('watcher-commands', Mockery::on(function (string $payload) use ($watchTask): bool {
                $decoded = json_decode($payload, true);

                return 'check_availability' === $decoded['type']
                    && $decoded['watchTaskId'] === $watchTask->id()
                    && 'Madrid' === $decoded['procedure']['province'];
            }));

        $redis = Mockery::mock(RedisFactory::class);
        $redis->shouldReceive('connection')->once()->withNoArgs()->andReturn($connection);

        $log = Mockery::mock(LogManager::class);
        $log->shouldReceive('withContext')->once()->with(Mockery::on(function (array $context) use ($watchTask): bool {
            return $context['watch_task_id'] === $watchTask->id() && is_string($context['command_id']);
        }));
        $log->shouldReceive('info')->once()->with('Dispatched availability check command to node-worker.');

        $gateway = new RedisWorkerGateway($redis, $log);

        $gateway->dispatchAvailabilityCheck($watchTask);
    }
}
