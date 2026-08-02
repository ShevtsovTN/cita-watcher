<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Messaging;

use App\Domain\Watcher\WatchTask;

/**
 * Wire payload published onto the `watcher-commands` Redis list for node-worker to deserialize.
 * Shape must stay in sync with whatever node-worker's messaging module expects — see
 * ../../../../../docs/NODE_WORKER_ROADMAP.md Phase 3; that module doesn't exist yet, so this is
 * the initial contract, not a confirmed one.
 */
final readonly class WorkerCommand
{
    private function __construct(
        public string $type,
        public ?int $watchTaskId,
        public array $procedure,
        public array $applicant,
    ) {}

    public static function forAvailabilityCheck(WatchTask $watchTask): self
    {
        return new self(
            type: 'check_availability',
            watchTaskId: $watchTask->id(),
            procedure: [
                'province' => $watchTask->procedure()->province,
                'tramiteCode' => $watchTask->procedure()->tramiteCode,
            ],
            applicant: [
                'fullName' => $watchTask->applicantData()->fullName,
                'documentId' => $watchTask->applicantData()->documentId,
                'email' => $watchTask->applicantData()->email,
                'phone' => $watchTask->applicantData()->phone,
            ],
        );
    }

    /**
     * @return array{type: string, watchTaskId: ?int, procedure: array{province: string, tramiteCode: string}, applicant: array{fullName: string, documentId: string, email: string, phone: ?string}}
     */
    public function toArray(): array
    {
        return [
            'type' => $this->type,
            'watchTaskId' => $this->watchTaskId,
            'procedure' => $this->procedure,
            'applicant' => $this->applicant,
        ];
    }
}
