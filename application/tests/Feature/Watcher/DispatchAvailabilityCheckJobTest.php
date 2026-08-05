<?php

declare(strict_types=1);

namespace Tests\Feature\Watcher;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Application\Watcher\Ports\WorkerGatewayInterface;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Persistence\Models\User;
use App\Presentation\Jobs\DispatchAvailabilityCheckJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Mockery;
use Mockery\Adapter\Phpunit\MockeryPHPUnitIntegration;
use Tests\TestCase;

final class DispatchAvailabilityCheckJobTest extends TestCase
{
    use RefreshDatabase;
    use MockeryPHPUnitIntegration;

    public function test_it_is_dispatched_onto_the_watcher_commands_queue(): void
    {
        Queue::fake();

        DispatchAvailabilityCheckJob::dispatch(42);

        Queue::assertPushedOn('watcher-commands', DispatchAvailabilityCheckJob::class);
    }

    public function test_handle_runs_the_use_case_through_the_container_and_transitions_the_task_to_running(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save(new WatchTask(
            id: null,
            userId: $user->id,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com', documentType: DocumentTypeEnum::DNI, birthYear: 1990, nationality: 'España'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        ));

        $gateway = Mockery::mock(WorkerGatewayInterface::class);
        $gateway->shouldReceive('dispatchAvailabilityCheck')->once();
        $this->app->instance(WorkerGatewayInterface::class, $gateway);

        DispatchAvailabilityCheckJob::dispatch($watchTask->id());

        $this->assertSame(WatchTaskStatusEnum::RUNNING, $repository->find($watchTask->id())->status());
    }
}
