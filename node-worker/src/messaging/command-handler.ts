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
 *
 * Phase 7 addition: `checkAvailability` no longer auto-releases the session for a
 * `captcha_blocked_slots_offered` outcome (see `../automation/availability-checker.ts`) — this
 * handler is what actually pauses for a human now. It generates a `SessionToken`, registers the
 * still-live session with `CaptchaSessionRegistry` (bridging to `index.ts`'s WS relay), publishes
 * `CaptchaRequiredEvent{sessionToken}` immediately (before waiting, so a human learns about it
 * promptly), then awaits either `CaptchaSessionRegistry.notifyResolved()` firing or a timeout —
 * whichever comes first — before releasing the session.
 *
 * Phase 8 addition: the CDP relay (`../captcha/input-relay.ts`) gives a connected human raw,
 * unscoped `Input.dispatchMouseEvent`/`dispatchKeyEvent` control of the whole page, not just a
 * captcha text field — so by the time `"resolved"` fires, the human has presumably already
 * clicked through whatever was left of the 5-step wizard themselves (captcha → `acVerificarCita`
 * → `acGrabarCita`) via the still-undesigned screencast UI. On `"resolved"`, this handler now
 * inspects the resulting page (`classifyPostResolutionOutcome`) and publishes exactly one more
 * `CheckFailedEvent` about it — never a guess at success, since no real `acGrabarCita` success
 * screen has ever been observed live (see `site-navigator.ts`'s `PostResolutionOutcome` docblock).
 * On `"timeout"` (our own, shorter than the site's real ~5-minute window), still publishes
 * nothing further: a timeout on our side isn't an observation of the page, so classifying it would
 * be exactly the kind of guess this codebase consistently avoids presenting as fact.
 */

import type { AvailabilityCheckRunner, SessionManager } from "../automation";
import { checkAvailability, classifyPostResolutionOutcome } from "../automation";
import type { CaptchaSessionRegistry } from "../captcha";
import { logger as defaultLogger, type Logger } from "../logger";
import { generateSessionToken, type SessionToken } from "../session-token";
import type { WorkerCommand, WorkerEvent } from "../types";
import { mapNavigationOutcomeToCheckFailedEvent, mapPostResolutionOutcomeToCheckFailedEvent } from "./outcome-to-event";
import type { EventPublisher } from "./redis-event-publisher";
import type { WorkerCommandHandler } from "./redis-command-consumer";

type Clock = () => Date;
/** Returns a cancel function, mirroring the real `setTimeout`/`clearTimeout` pair — injectable so tests don't wait for a real multi-minute timeout. */
type ScheduleTimeout = (ms: number, callback: () => void) => () => void;

const defaultScheduleTimeout: ScheduleTimeout = (ms, callback) => {
    const handle = setTimeout(callback, ms);
    return () => {
        clearTimeout(handle);
    };
};

/**
 * Only a fallback for callers that don't pass `captchaResolutionTimeoutMs` explicitly (matches
 * `config.ts`'s own `CAPTCHA_RESOLUTION_TIMEOUT_MS` default) — this module doesn't import `config`
 * directly, since only `index.ts` (the composition root) reads it; every other collaborator here
 * receives config-derived values through `WorkerCommandHandlerDeps` instead.
 */
const DEFAULT_CAPTCHA_RESOLUTION_TIMEOUT_MS = 240_000;

export interface WorkerCommandHandlerDeps {
    readonly sessionManager: SessionManager;
    readonly eventPublisher: EventPublisher;
    readonly captchaRegistry: CaptchaSessionRegistry;
    readonly captchaResolutionTimeoutMs?: number;
    readonly now?: Clock;
    readonly runCheck?: AvailabilityCheckRunner;
    readonly logger?: Logger;
    readonly generateToken?: () => SessionToken;
    readonly scheduleTimeout?: ScheduleTimeout;
}

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

export function createWorkerCommandHandler(deps: WorkerCommandHandlerDeps): WorkerCommandHandler {
    const {
        sessionManager,
        eventPublisher,
        captchaRegistry,
        captchaResolutionTimeoutMs = DEFAULT_CAPTCHA_RESOLUTION_TIMEOUT_MS,
        now = () => new Date(),
        runCheck,
        logger = defaultLogger,
        generateToken = generateSessionToken,
        scheduleTimeout = defaultScheduleTimeout,
    } = deps;

    return async (command: WorkerCommand): Promise<void> => {
        const commandLogger = logger.withContext({ command_id: command.commandId, watch_task_id: command.watchTaskId });
        const request = {
            province: command.procedure.province,
            tramiteLabel: command.procedure.tramiteCode,
            applicant: command.applicant,
            ...(command.procedure.sede === undefined ? {} : { sede: command.procedure.sede }),
        };

        let event: WorkerEvent;
        try {
            const { outcome, pendingCaptchaSession } =
                runCheck === undefined
                    ? await checkAvailability(request, sessionManager, undefined, commandLogger)
                    : await checkAvailability(request, sessionManager, runCheck, commandLogger);

            if (outcome.type === "captcha_blocked_slots_offered" && pendingCaptchaSession !== undefined) {
                const token = generateToken();
                try {
                    await eventPublisher.publish({
                        type: "captcha_required",
                        watchTaskId: command.watchTaskId,
                        occurredAt: now().toISOString(),
                        sessionToken: token,
                    });
                    commandLogger.info("published worker event", { type: "captcha_required" });

                    const resolution = await new Promise<"resolved" | "timeout">((resolvePromise) => {
                        let settled = false;
                        const cancelTimeout = scheduleTimeout(captchaResolutionTimeoutMs, () => {
                            if (!settled) {
                                settled = true;
                                resolvePromise("timeout");
                            }
                        });
                        captchaRegistry.register(token, pendingCaptchaSession, () => {
                            if (!settled) {
                                settled = true;
                                cancelTimeout();
                                resolvePromise("resolved");
                            }
                        });
                    });
                    commandLogger.info("captcha session ended", { resolution });

                    if (resolution === "resolved") {
                        const postOutcome = await classifyPostResolutionOutcome(pendingCaptchaSession.page, request.province);
                        const postEvent = mapPostResolutionOutcomeToCheckFailedEvent(
                            postOutcome,
                            command.watchTaskId,
                            now().toISOString(),
                        );
                        await eventPublisher.publish(postEvent);
                        commandLogger.info("published worker event", { type: postEvent.type, retryable: postEvent.retryable });
                    }
                } finally {
                    captchaRegistry.unregister(token);
                    await sessionManager.release(pendingCaptchaSession);
                }
                return;
            }

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
            reason: event.type === "check_failed" ? event.reason : undefined,
        });
    };
}
