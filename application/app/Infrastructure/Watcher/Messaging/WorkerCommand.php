<?php

declare(strict_types=1);

namespace App\Infrastructure\Watcher\Messaging;

use App\Domain\Watcher\WatchTask;
use Illuminate\Support\Str;

/**
 * Wire payload published onto the `watcher-commands` Redis list for node-worker to deserialize.
 * Shape must stay in sync with whatever node-worker's messaging module expects — see
 * ../../../../../docs/NODE_WORKER_ROADMAP.md Phase 3; that module doesn't exist yet, so this is
 * the initial contract, not a confirmed one.
 *
 * `commandId` (Phase 8) is a UUID for log correlation only — node-worker is expected to echo it
 * back on whatever event it eventually publishes for this command, but nothing on the Laravel side
 * persists or verifies it; see RedisWorkerGateway's docblock.
 */
final readonly class WorkerCommand
{
    private function __construct(
        public string $commandId,
        public string $type,
        public ?int $watchTaskId,
        public array $procedure,
        public array $applicant,
    ) {}

    public static function forAvailabilityCheck(WatchTask $watchTask): self
    {
        return new self(
            commandId: (string) Str::uuid(),
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
     * @return array{commandId: string, type: string, watchTaskId: ?int, procedure: array{province: string, tramiteCode: string}, applicant: array{fullName: string, documentId: string, email: string, phone: ?string}}
     */
    public function toArray(): array
    {
        return [
            'commandId' => $this->commandId,
            'type' => $this->type,
            'watchTaskId' => $this->watchTaskId,
            'procedure' => $this->procedure,
            'applicant' => $this->applicant,
        ];
    }
}
