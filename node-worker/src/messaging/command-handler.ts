/**
 * Собирает воедино `automation/` и `messaging/`: то, что реально запускает проверку по
 * `WorkerCommand`, попавшей из `RedisCommandConsumer`, и публикует результат через
 * `EventPublisher` — "trigger an automation run", о котором `redis-command-consumer.ts`'s докблок
 * говорит "дело вызывающей стороны". См. ../../docs/NODE_WORKER_ROADMAP.md Phase 3.
 *
 * `command.procedure.tramiteCode` передаётся в `checkAvailability` как `tramiteLabel` напрямую, без
 * какого-либо преобразования. Это осознанное решение, а не недосмотр: `tramiteCode` на
 * Laravel-стороне (`Procedure.php`) — валидируется только как непустая строка, никакой enum/
 * справочник кодов там не существует, и ничего в кодовой базе сегодня не придаёт ему иного смысла.
 * Реальная таблица код→label (по провинциям, как `../automation/province-routes.ts`) потребовала
 * бы отдельного recon такого же масштаба — вместо этого действующее соглашение: тот, кто создаёт
 * `WatchTask`, обязан ввести в `tramiteCode` ровно видимый испанский текст опции `<select>` на
 * сайте. Если это соглашение перестанет быть достаточным, вводить настоящую таблицу — отдельная
 * задача, не эта.
 *
 * Phase 5 addition: an uncaught exception from `checkAvailability` itself (a real Playwright crash,
 * a network timeout — anything not already modeled as a `NavigationOutcome`) used to propagate all
 * the way out to `index.ts`'s `withErrorHandling`, which only logs it — the command silently never
 * got a `CheckFailedEvent` at all, leaving its `WatchTask` stuck. Caught here instead and mapped to
 * a `retryable: true` `CheckFailedEvent`, same conservative "unknown means retryable" choice
 * `outcome-to-event.ts` already makes for `post_submit_unconfirmed`. `index.ts`'s wrapper stays as
 * a last-resort net for failures even this can't catch (e.g. `eventPublisher.publish()` itself
 * throwing because Redis is down).
 */

import type { AvailabilityCheckRunner, SessionManager } from "../automation";
import { checkAvailability } from "../automation";
import { logger as defaultLogger, type Logger } from "../logger";
import type { WorkerCommand, WorkerEvent } from "../types";
import { mapNavigationOutcomeToCheckFailedEvent } from "./outcome-to-event";
import type { EventPublisher } from "./redis-event-publisher";
import type { WorkerCommandHandler } from "./redis-command-consumer";

type Clock = () => Date;

function toUnexpectedFailureEvent(error: unknown, watchTaskId: number, occurredAt: string): WorkerEvent {
    const reason = error instanceof Error ? error.message : String(error);

    return {
        type: "check_failed",
        watchTaskId,
        reason: `Unexpected error: ${reason}`,
        retryable: true,
        occurredAt,
    };
}

export function createWorkerCommandHandler(
    sessionManager: SessionManager,
    eventPublisher: EventPublisher,
    now: Clock = () => new Date(),
    runCheck?: AvailabilityCheckRunner,
    logger: Logger = defaultLogger,
): WorkerCommandHandler {
    return async (command: WorkerCommand): Promise<void> => {
        const commandLogger = logger.withContext({ command_id: command.commandId, watch_task_id: command.watchTaskId });
        const request = {
            province: command.procedure.province,
            tramiteLabel: command.procedure.tramiteCode,
            applicant: command.applicant,
        };

        let event: WorkerEvent;
        try {
            const outcome =
                runCheck === undefined
                    ? await checkAvailability(request, sessionManager)
                    : await checkAvailability(request, sessionManager, runCheck);

            event = mapNavigationOutcomeToCheckFailedEvent(outcome, command.watchTaskId, now().toISOString());
        } catch (error) {
            event = toUnexpectedFailureEvent(error, command.watchTaskId, now().toISOString());
            commandLogger.error("check crashed with an unexpected error, publishing a retryable check_failed", {
                reason: event.type === "check_failed" ? event.reason : undefined,
            });
        }

        await eventPublisher.publish(event);
        commandLogger.info("published worker event", {
            type: event.type,
            retryable: event.type === "check_failed" ? event.retryable : undefined,
        });
    };
}
