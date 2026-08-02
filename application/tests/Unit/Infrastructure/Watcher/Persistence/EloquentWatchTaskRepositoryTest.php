<?php

declare(strict_types=1);

namespace Tests\Unit\Infrastructure\Watcher\Persistence;

use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Persistence\Models\User;
use App\Infrastructure\Persistence\Models\WatchTask as WatchTaskModel;
use App\Infrastructure\Watcher\Persistence\EloquentWatchTaskRepository;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class EloquentWatchTaskRepositoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_save_persists_a_new_watch_task_and_assigns_an_id(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(EloquentWatchTaskRepository::class);

        $persisted = $repository->save($this->makeWatchTask($user->id));

        $this->assertNotNull($persisted->id());
        $this->assertSame($user->id, $persisted->userId());
        $this->assertSame(WatchTaskStatusEnum::PENDING, $persisted->status());
    }

    public function test_find_returns_null_for_an_unknown_id(): void
    {
        $repository = $this->app->make(EloquentWatchTaskRepository::class);

        $this->assertNull($repository->find(999));
    }

    public function test_find_returns_a_previously_saved_watch_task_with_all_data_intact(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(EloquentWatchTaskRepository::class);

        $saved = $repository->save($this->makeWatchTask($user->id, phone: '600123456'));

        $found = $repository->find($saved->id());

        $this->assertNotNull($found);
        $this->assertSame($saved->id(), $found->id());
        $this->assertSame($user->id, $found->userId());
        $this->assertSame('Madrid', $found->procedure()->province);
        $this->assertSame('CITA_DNI', $found->procedure()->tramiteCode);
        $this->assertSame('Juan Pérez', $found->applicantData()->fullName);
        $this->assertSame('12345678A', $found->applicantData()->documentId);
        $this->assertSame('juan@example.com', $found->applicantData()->email);
        $this->assertSame('600123456', $found->applicantData()->phone);
        $this->assertSame(WatchTaskNotificationChannelEnum::TELEGRAM, $found->notificationChannel());
        $this->assertSame('123456789', $found->notificationTarget());
        $this->assertSame(WatchTaskStatusEnum::PENDING, $found->status());
    }

    public function test_save_stores_applicant_data_encrypted_at_rest(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(EloquentWatchTaskRepository::class);

        $saved = $repository->save($this->makeWatchTask($user->id));

        $raw = WatchTaskModel::query()->findOrFail($saved->id())->getRawOriginal('applicant_data');

        $this->assertStringNotContainsString('Juan Pérez', $raw);
        $this->assertStringNotContainsString('12345678A', $raw);
        $this->assertStringNotContainsString('juan@example.com', $raw);
    }

    public function test_save_updates_an_existing_watch_task_in_place(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(EloquentWatchTaskRepository::class);

        $watchTask = $repository->save($this->makeWatchTask($user->id));
        $watchTask->start();

        $updated = $repository->save($watchTask);

        $this->assertSame($watchTask->id(), $updated->id());
        $this->assertSame(WatchTaskStatusEnum::RUNNING, $repository->find($watchTask->id())->status());
    }

    public function test_find_pending_returns_only_pending_watch_tasks(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(EloquentWatchTaskRepository::class);

        $pending = $repository->save($this->makeWatchTask($user->id));
        $running = $repository->save($this->makeWatchTask($user->id));
        $running->start();
        $repository->save($running);

        $found = $repository->findPending();

        $this->assertCount(1, $found);
        $this->assertSame($pending->id(), $found[0]->id());
        $this->assertSame(WatchTaskStatusEnum::PENDING, $found[0]->status());
    }

    public function test_delete_removes_the_watch_task(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(EloquentWatchTaskRepository::class);

        $watchTask = $repository->save($this->makeWatchTask($user->id));

        $repository->delete($watchTask);

        $this->assertNull($repository->find($watchTask->id()));
    }

    private function makeWatchTask(int $userId, ?string $phone = null): WatchTask
    {
        return new WatchTask(
            id: null,
            userId: $userId,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(
                fullName: 'Juan Pérez',
                documentId: '12345678A',
                email: 'juan@example.com',
                phone: $phone,
            ),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
