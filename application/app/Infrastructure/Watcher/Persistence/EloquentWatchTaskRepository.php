<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Persistence;

use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use App\Domain\Watcher\Repository\WatchTaskRepositoryInterface;
use App\Domain\Watcher\ValueObjects\ApplicantData;
use App\Domain\Watcher\ValueObjects\Procedure;
use App\Domain\Watcher\WatchTask;
use App\Infrastructure\Persistence\Models\WatchTask as WatchTaskModel;

final class EloquentWatchTaskRepository implements WatchTaskRepositoryInterface
{
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
            'applicant_full_name' => $watchTask->applicantData()->fullName,
            'applicant_document_id' => $watchTask->applicantData()->documentId,
            'applicant_email' => $watchTask->applicantData()->email,
            'applicant_phone' => $watchTask->applicantData()->phone,
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

    private function toDomain(WatchTaskModel $model): WatchTask
    {
        return new WatchTask(
            id: $model->id,
            userId: $model->user_id,
            procedure: new Procedure(
                province: $model->province,
                tramiteCode: $model->tramite_code,
            ),
            applicantData: new ApplicantData(
                fullName: $model->applicant_full_name,
                documentId: $model->applicant_document_id,
                email: $model->applicant_email,
                phone: $model->applicant_phone,
            ),
            notificationChannel: $model->notification_channel,
            notificationTarget: $model->notification_target,
            status: $model->status,
        );
    }
}
