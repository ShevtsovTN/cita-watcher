<?php

declare(strict_types=1);

namespace Tests\Feature\Watcher;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Persistence\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

final class WatchTaskControllerTest extends TestCase
{
    use RefreshDatabase;

    public function test_unauthenticated_requests_are_rejected(): void
    {
        $this->getJson('/api/watch-tasks')->assertStatus(401);
    }

    public function test_it_creates_a_watch_task_without_leaking_the_document_id_in_the_response(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $response = $this->postJson('/api/watch-tasks', $this->createPayload());

        $response->assertStatus(201);
        $response->assertJsonPath('data.status', 'pending');
        $response->assertJsonPath('data.procedure.province', 'Madrid');
        $response->assertJsonPath('data.procedure.sede', 'CNP Benidorm TIE');
        $response->assertJsonPath('data.applicant.fullName', 'Juan Pérez');
        $response->assertJsonMissingPath('data.applicant.documentId');
        $this->assertStringNotContainsString('12345678A', $response->getContent());
    }

    public function test_it_creates_a_watch_task_with_no_sede(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $payload = $this->createPayload();
        unset($payload['sede']);

        $response = $this->postJson('/api/watch-tasks', $payload);

        $response->assertStatus(201);
        $response->assertJsonPath('data.procedure.sede', null);
    }

    public function test_create_validation_errors_return_422(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $response = $this->postJson('/api/watch-tasks', []);

        $response->assertStatus(422);
    }

    public function test_index_returns_only_the_authenticated_users_watch_tasks(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);

        $owned = $repository->save($this->makeWatchTask($user->id));
        $repository->save($this->makeWatchTask($otherUser->id));

        Sanctum::actingAs($user);

        $response = $this->getJson('/api/watch-tasks');

        $response->assertStatus(200);
        $response->assertJsonCount(1, 'data');
        $response->assertJsonPath('data.0.id', $owned->id());
    }

    public function test_show_returns_404_for_another_users_watch_task(): void
    {
        $owner = User::factory()->create();
        $requester = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);

        $watchTask = $repository->save($this->makeWatchTask($owner->id));

        Sanctum::actingAs($requester);

        $this->getJson("/api/watch-tasks/{$watchTask->id()}")->assertStatus(404);
    }

    public function test_pause_transitions_a_pending_watch_task(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask($user->id));

        Sanctum::actingAs($user);

        $response = $this->postJson("/api/watch-tasks/{$watchTask->id()}/pause");

        $response->assertStatus(200);
        $response->assertJsonPath('data.status', 'paused');
    }

    public function test_pause_returns_409_for_a_terminal_watch_task(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask($user->id));
        $watchTask->start();
        $watchTask->complete();
        $repository->save($watchTask);

        Sanctum::actingAs($user);

        $this->postJson("/api/watch-tasks/{$watchTask->id()}/pause")->assertStatus(409);
    }

    public function test_pause_returns_404_for_another_users_watch_task(): void
    {
        $owner = User::factory()->create();
        $requester = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask($owner->id));

        Sanctum::actingAs($requester);

        $this->postJson("/api/watch-tasks/{$watchTask->id()}/pause")->assertStatus(404);
    }

    public function test_resume_transitions_a_paused_watch_task(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask($user->id));
        $watchTask->pause();
        $repository->save($watchTask);

        Sanctum::actingAs($user);

        $response = $this->postJson("/api/watch-tasks/{$watchTask->id()}/resume");

        $response->assertStatus(200);
        $response->assertJsonPath('data.status', 'pending');
    }

    public function test_resume_returns_409_when_the_watch_task_is_not_paused(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask($user->id));

        Sanctum::actingAs($user);

        $this->postJson("/api/watch-tasks/{$watchTask->id()}/resume")->assertStatus(409);
    }

    public function test_delete_removes_the_watch_task(): void
    {
        $user = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask($user->id));

        Sanctum::actingAs($user);

        $this->deleteJson("/api/watch-tasks/{$watchTask->id()}")->assertStatus(204);

        $this->assertNull($repository->find($watchTask->id()));
    }

    public function test_delete_returns_404_for_another_users_watch_task(): void
    {
        $owner = User::factory()->create();
        $requester = User::factory()->create();
        $repository = $this->app->make(WatchTaskRepositoryInterface::class);
        $watchTask = $repository->save($this->makeWatchTask($owner->id));

        Sanctum::actingAs($requester);

        $this->deleteJson("/api/watch-tasks/{$watchTask->id()}")->assertStatus(404);
    }

    /**
     * @return array<string, mixed>
     */
    private function createPayload(): array
    {
        return [
            'province' => 'Madrid',
            'tramiteCode' => 'CITA_DNI',
            'sede' => 'CNP Benidorm TIE',
            'fullName' => 'Juan Pérez',
            'documentType' => 'dni',
            'documentId' => '12345678A',
            'email' => 'juan@example.com',
            'phone' => '600123456',
            'birthYear' => 1990,
            'nationality' => 'España',
            'notificationChannel' => 'telegram',
            'notificationTarget' => '123456789',
        ];
    }

    private function makeWatchTask(int $userId): WatchTask
    {
        return new WatchTask(
            id: null,
            userId: $userId,
            procedure: new Procedure(province: 'Madrid', tramiteCode: 'CITA_DNI'),
            applicantData: new ApplicantData(fullName: 'Juan Pérez', documentId: '12345678A', email: 'juan@example.com', documentType: DocumentTypeEnum::DNI, birthYear: 1990, nationality: 'España'),
            notificationChannel: WatchTaskNotificationChannelEnum::TELEGRAM,
            notificationTarget: '123456789',
        );
    }
}
