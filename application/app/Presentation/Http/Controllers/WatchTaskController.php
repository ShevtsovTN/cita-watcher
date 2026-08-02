<?php

declare(strict_types=1);

namespace App\Presentation\Http\Controllers;

use App\Application\Watcher\UseCases\CreateWatchTaskUseCase;
use App\Application\Watcher\UseCases\DeleteWatchTaskUseCase;
use App\Application\Watcher\UseCases\GetWatchTaskUseCase;
use App\Application\Watcher\UseCases\ListWatchTasksUseCase;
use App\Application\Watcher\UseCases\PauseWatchTaskUseCase;
use App\Application\Watcher\UseCases\ResumeWatchTaskUseCase;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Presentation\Http\Requests\CreateWatchTaskRequest;
use App\Presentation\Http\Resources\WatchTaskResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

final class WatchTaskController extends Controller
{
    public function __construct(
        private readonly ListWatchTasksUseCase $listWatchTasks,
        private readonly GetWatchTaskUseCase $getWatchTask,
        private readonly CreateWatchTaskUseCase $createWatchTask,
        private readonly PauseWatchTaskUseCase $pauseWatchTask,
        private readonly ResumeWatchTaskUseCase $resumeWatchTask,
        private readonly DeleteWatchTaskUseCase $deleteWatchTask,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        return WatchTaskResource::collection($this->listWatchTasks->execute($request->user()->id));
    }

    public function show(Request $request, int $watchTask): WatchTaskResource
    {
        return new WatchTaskResource($this->getWatchTask->execute($watchTask, $request->user()->id));
    }

    public function store(CreateWatchTaskRequest $request): JsonResponse
    {
        $watchTask = $this->createWatchTask->execute(
            userId: $request->user()->id,
            procedure: new Procedure(
                province: $request->string('province')->toString(),
                tramiteCode: $request->string('tramiteCode')->toString(),
            ),
            applicantData: new ApplicantData(
                fullName: $request->string('fullName')->toString(),
                documentId: $request->string('documentId')->toString(),
                email: $request->string('email')->toString(),
                phone: $request->string('phone')->toString() ?: null,
            ),
            notificationChannel: $request->enum('notificationChannel', WatchTaskNotificationChannelEnum::class),
            notificationTarget: $request->string('notificationTarget')->toString(),
        );

        return (new WatchTaskResource($watchTask))->response()->setStatusCode(201);
    }

    public function pause(Request $request, int $watchTask): WatchTaskResource
    {
        return new WatchTaskResource($this->pauseWatchTask->execute($watchTask, $request->user()->id));
    }

    public function resume(Request $request, int $watchTask): WatchTaskResource
    {
        return new WatchTaskResource($this->resumeWatchTask->execute($watchTask, $request->user()->id));
    }

    public function destroy(Request $request, int $watchTask): JsonResponse
    {
        $this->deleteWatchTask->execute($watchTask, $request->user()->id);

        return response()->json(null, 204);
    }
}
