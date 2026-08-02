<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Watcher\Messaging;

use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Watcher\Messaging\WorkerCommand;
use PHPUnit\Framework\TestCase;

final class WorkerCommandTest extends TestCase
{
    public function test_for_availability_check_maps_a_watch_task_to_the_wire_shape(): void
    {
        $watchTask = new WatchTask(
            id: 42,
            userId: 7,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(
                fullName: 'Juan Pérez',
                documentId: '12345678A',
                email: 'juan@example.com',
                phone: '600123456',
            ),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );

        $command = WorkerCommand::forAvailabilityCheck($watchTask);

        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/',
            $command->commandId,
        );

        $this->assertSame([
            'commandId' => $command->commandId,
            'type' => 'check_availability',
            'watchTaskId' => 42,
            'procedure' => [
                'province' => 'Madrid',
                'tramiteCode' => 'CITA_DNI',
            ],
            'applicant' => [
                'fullName' => 'Juan Pérez',
                'documentId' => '12345678A',
                'email' => 'juan@example.com',
                'phone' => '600123456',
            ],
        ], $command->toArray());
    }

    public function test_each_command_gets_a_unique_command_id(): void
    {
        $watchTask = new WatchTask(
            id: 42,
            userId: 7,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );

        $first = WorkerCommand::forAvailabilityCheck($watchTask);
        $second = WorkerCommand::forAvailabilityCheck($watchTask);

        $this->assertNotSame($first->commandId, $second->commandId);
    }
}
