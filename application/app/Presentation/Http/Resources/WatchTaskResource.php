<?php

declare(strict_types=1);

namespace App\Presentation\Http\Resources;

use App\Domain\Watcher\WatchTask;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property WatchTask $resource
 */
final class WatchTaskResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->resource->id(),
            'status' => $this->resource->status()->value,
            'procedure' => [
                'province' => $this->resource->procedure()->province,
                'tramiteCode' => $this->resource->procedure()->tramiteCode,
            ],
            // documentId/documentType/birthYear/nationality are deliberately omitted — see
            // docs/APPLICATION_ROADMAP.md Phase 7 notes; none of it ever needs to round-trip back
            // to the client that already knows it.
            'applicant' => [
                'fullName' => $this->resource->applicantData()->fullName,
                'email' => $this->resource->applicantData()->email,
                'phone' => $this->resource->applicantData()->phone,
            ],
            'notificationChannel' => $this->resource->notificationChannel()->value,
            'notificationTarget' => $this->resource->notificationTarget(),
        ];
    }
}
