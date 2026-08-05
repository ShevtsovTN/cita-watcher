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
 */

import type { AvailabilityCheckRunner, SessionManager } from "../automation";
import { checkAvailability } from "../automation";
import type { WorkerCommand } from "../types";
import { mapNavigationOutcomeToCheckFailedEvent } from "./outcome-to-event";
import type { EventPublisher } from "./redis-event-publisher";
import type { WorkerCommandHandler } from "./redis-command-consumer";

type Clock = () => Date;

export function createWorkerCommandHandler(
    sessionManager: SessionManager,
    eventPublisher: EventPublisher,
    now: Clock = () => new Date(),
    /** Тот же DI-шов, что третий параметр `checkAvailability` — по умолчанию реальная навигация. */
    runCheck?: AvailabilityCheckRunner,
): WorkerCommandHandler {
    return async (command: WorkerCommand): Promise<void> => {
        const request = {
            province: command.procedure.province,
            tramiteLabel: command.procedure.tramiteCode,
            applicant: command.applicant,
        };
        const outcome =
            runCheck === undefined
                ? await checkAvailability(request, sessionManager)
                : await checkAvailability(request, sessionManager, runCheck);

        const event = mapNavigationOutcomeToCheckFailedEvent(outcome, command.watchTaskId, now().toISOString());

        await eventPublisher.publish(event);
    };
}
