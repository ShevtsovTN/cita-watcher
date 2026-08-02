<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Persistence;

use App\Application\Watcher\Ports\ApplicantDataEncryptorInterface;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Persistence\Models\WatchTask as WatchTaskModel;

final class EloquentWatchTaskRepository implements WatchTaskRepositoryInterface
{
    public function __construct(
        private readonly ApplicantDataEncryptorInterface $applicantDataEncryptor,
    ) {}

    public function find(int $id): ?WatchTask
    {
        $model = WatchTaskModel::query()->find($id);

        return null === $model ? null : $this->toDomain($model);
    }

    public function save(WatchTask $watchTask): WatchTask
    {
        $model = null === $watchTask->id()
            ? new WatchTaskModel()
            : WatchTaskModel::query()->findOrFail($watchTask->id());

        $model->fill([
            'user_id' => $watchTask->userId(),
            'province' => $watchTask->procedure()->province,
            'tramite_code' => $watchTask->procedure()->tramiteCode,
            'applicant_data' => $this->applicantDataEncryptor->encrypt($watchTask->applicantData()),
            'notification_channel' => $watchTask->notificationChannel(),
            'notification_target' => $watchTask->notificationTarget(),
            'status' => $watchTask->status(),
        ]);

        $model->save();

        return $this->toDomain($model);
    }

    public function delete(WatchTask $watchTask): void
    {
        if (null !== $watchTask->id()) {
            WatchTaskModel::destroy($watchTask->id());
        }
    }

    public function findPending(): array
    {
        return WatchTaskModel::query()
            ->where('status', WatchTaskStatusEnum::PENDING)
            ->get()
            ->map(fn(WatchTaskModel $model): WatchTask => $this->toDomain($model))
            ->all();
    }

    public function findByUserId(int $userId): array
    {
        return WatchTaskModel::query()
            ->where('user_id', $userId)
            ->get()
            ->map(fn(WatchTaskModel $model): WatchTask => $this->toDomain($model))
            ->all();
    }

    private function toDomain(WatchTaskModel $model): WatchTask
    {
        return new WatchTask(
            id: $model->id,
            userId: $model->user_id,
            procedure: new Procedure(
                province: $model->province,
                tramiteCode: $model->tramite_code,
            ),
            applicantData: $this->applicantDataEncryptor->decrypt($model->applicant_data),
            notificationChannel: $model->notification_channel,
            notificationTarget: $model->notification_target,
            status: $model->status,
        );
    }
}
