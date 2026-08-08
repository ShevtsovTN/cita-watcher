/**
 * Тонкая обвязка над `runAvailabilityCheck` — closes roadmap Phase 1's "session cleanup/teardown"
 * item (see ../../../docs/NODE_WORKER_ROADMAP.md): try/finally вокруг `acquire()`/`release()`, так
 * что сессия освобождается и при успехе, и при любой ошибке из проверки (неизвестная провинция/
 * trámite/национальность, либо реальное исключение Playwright) — за одним подтверждённым
 * исключением (Phase 7): `captcha_blocked_slots_offered` намеренно НЕ освобождает сессию здесь —
 * страница с видимой капчей должна остаться живой, чтобы человек мог её решить через
 * `../captcha/`'s screencast/input relay. Владение release() в этом случае переходит вызывающей
 * стороне (`../messaging/command-handler.ts`) через `pendingCaptchaSession`. Не интерпретирует
 * `NavigationOutcome` иначе (например, не решает `retryable`) — это задача `messaging/`.
 *
 * Optional `logger` param (added after a real 2026-08-08 live debugging session against the actual
 * site, see `./remote-response-logger.ts`'s own docblock for why): when provided, wires up
 * `attachRemoteResponseLogging` on the acquired session's page before `runCheck` touches it, so
 * every remote HTTP response/console error/page error the check encounters is logged under the
 * caller's correlation context (`command-handler.ts` passes its `command_id`/`watch_task_id`-bound
 * logger). Deliberately opt-in, not unconditional: existing tests here use a bare `{} as Page` fake
 * with no `.on()`, and forcing every caller to supply a real event-emitting `Page` for a diagnostic
 * feature would be a worse trade than just skipping attachment when no logger is given.
 */
import type { Page } from "playwright";

import type { Logger } from "../logger";
import { attachRemoteResponseLogging } from "./remote-response-logger";
import type { AutomationSession, SessionManager } from "./session-manager";
import { type CheckAvailabilityRequest, type NavigationOutcome, runAvailabilityCheck } from "./site-navigator";

export type AvailabilityCheckRunner = (page: Page, request: CheckAvailabilityRequest) => Promise<NavigationOutcome>;
export type RemoteLoggingAttacher = (page: Page, logger: Logger) => void;

export interface AvailabilityCheckResult {
    readonly outcome: NavigationOutcome;
    /**
     * Only set when `outcome.type === "captcha_blocked_slots_offered"` — `release()` was
     * deliberately skipped for this session. The caller now owns releasing it once the
     * human-solve window ends (resolved or timed out).
     */
    readonly pendingCaptchaSession?: AutomationSession;
}

export async function checkAvailability(
    request: CheckAvailabilityRequest,
    sessionManager: SessionManager,
    runCheck: AvailabilityCheckRunner = runAvailabilityCheck,
    logger?: Logger,
    attachLogging: RemoteLoggingAttacher = attachRemoteResponseLogging,
): Promise<AvailabilityCheckResult> {
    const session = await sessionManager.acquire();
    if (logger !== undefined) attachLogging(session.page, logger);

    let outcome: NavigationOutcome;
    try {
        outcome = await runCheck(session.page, request);
    } catch (error) {
        await sessionManager.release(session);
        throw error;
    }

    if (outcome.type === "captcha_blocked_slots_offered") {
        return { outcome, pendingCaptchaSession: session };
    }

    await sessionManager.release(session);
    return { outcome };
}
