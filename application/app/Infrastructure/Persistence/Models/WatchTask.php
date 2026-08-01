<?php

declare(strict_types=1);

namespace App\Infrastructure\Persistence\Models;

use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use App\Domain\Watcher\Enums\WatchTaskStatusEnum;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable([
    'user_id',
    'province',
    'tramite_code',
    'applicant_full_name',
    'applicant_document_id',
    'applicant_email',
    'applicant_phone',
    'notification_channel',
    'notification_target',
    'status',
])]
class WatchTask extends Model
{
    /**
     * @return array<string, class-string>
     */
    protected function casts(): array
    {
        return [
            'status' => WatchTaskStatusEnum::class,
            'notification_channel' => WatchTaskNotificationChannelEnum::class,
        ];
    }
}
