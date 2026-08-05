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
 */
import type { Page } from "playwright";

import type { AutomationSession, SessionManager } from "./session-manager";
import { type CheckAvailabilityRequest, type NavigationOutcome, runAvailabilityCheck } from "./site-navigator";

export type AvailabilityCheckRunner = (page: Page, request: CheckAvailabilityRequest) => Promise<NavigationOutcome>;

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
): Promise<AvailabilityCheckResult> {
    const session = await sessionManager.acquire();

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
