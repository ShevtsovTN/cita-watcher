/**
 * Wire-контракт исходящих событий на канал `watcher-events` (node-worker → Laravel). См.
 * ../../../application/app/Infrastructure/Watcher/Messaging/WorkerEventRouter.php и
 * ../../../docs/NODE_WORKER_ROADMAP.md Phase 3 — та же оговорка про предварительность формы, что
 * и в `./commands`.
 */

import type { AppointmentSlot } from "./check-result";

export interface CheckCompletedEvent {
    readonly type: "check_completed";
    readonly watchTaskId: number;
    readonly slots: readonly AppointmentSlot[];
    /** ISO 8601. */
    readonly checkedAt: string;
}

export interface CaptchaRequiredEvent {
    readonly type: "captcha_required";
    readonly watchTaskId: number;
    /** ISO 8601. */
    readonly occurredAt: string;
    /**
     * Opaque token (`../session-token.ts`'s `SessionToken`) identifying the paused
     * `AutomationSession` — a human needs it to reach `/captcha-ws/<sessionToken>`. Node-worker
     * doesn't know Laravel's public `APP_URL`, so it publishes the bare token, not a full URL;
     * building `{APP_URL}/captcha-ws/{sessionToken}` is the consuming (Laravel) side's job.
     */
    readonly sessionToken: string;
}

export interface CheckFailedEvent {
    readonly type: "check_failed";
    readonly watchTaskId: number;
    readonly reason: string;
    /**
     * `true` для временных сбоев, за которые стоит взяться ещё раз по расписанию (сетевой таймаут,
     * сайт временно недоступен); `false` для сбоев, которые retry не исправит (например,
     * невалидная комбинация province/tramiteCode). Laravel доверяет этому флагу как есть, никакого
     * собственного анализа `reason` не делает — см. ../../../docs/NODE_WORKER_ROADMAP.md Phase 3.
     */
    readonly retryable: boolean;
    /** ISO 8601. */
    readonly occurredAt: string;
}

/** Дискриминировано по `type`. */
export type WorkerEvent = CheckCompletedEvent | CaptchaRequiredEvent | CheckFailedEvent;
