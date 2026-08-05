<?php

declare(strict_types=1);

namespace App\Presentation\Http\Requests;

use App\Domain\Watcher\Enums\DocumentTypeEnum;
use App\Domain\Watcher\Enums\WatchTaskNotificationChannelEnum;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

final class CreateWatchTaskRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'province' => ['required', 'string'],
            'tramiteCode' => ['required', 'string'],
            'fullName' => ['required', 'string'],
            'documentType' => ['required', Rule::enum(DocumentTypeEnum::class)],
            'documentId' => ['required', 'string'],
            'email' => ['required', 'email'],
            'phone' => ['nullable', 'string'],
            'birthYear' => ['required', 'integer', 'min:1900', 'max:' . date('Y')],
            'nationality' => ['required', 'string'],
            'notificationChannel' => ['required', Rule::enum(WatchTaskNotificationChannelEnum::class)],
            'notificationTarget' => ['required', 'string'],
        ];
    }
}
