/**
 * Тонкая обвязка над `runAvailabilityCheck` — closes roadmap Phase 1's "session cleanup/teardown"
 * item (see ../../../docs/NODE_WORKER_ROADMAP.md): try/finally вокруг `acquire()`/`release()`, так
 * что сессия освобождается и при успехе, и при любой ошибке из проверки (неизвестная провинция/
 * trámite/национальность, либо реальное исключение Playwright). Не интерпретирует
 * `NavigationOutcome` (например, не решает `retryable`) — это задача `messaging/` в Phase 3.
 */
import type { Page } from "playwright";

import type { SessionManager } from "./session-manager";
import { type CheckAvailabilityRequest, type NavigationOutcome, runAvailabilityCheck } from "./site-navigator";

export type AvailabilityCheckRunner = (page: Page, request: CheckAvailabilityRequest) => Promise<NavigationOutcome>;

export async function checkAvailability(
    request: CheckAvailabilityRequest,
    sessionManager: SessionManager,
    runCheck: AvailabilityCheckRunner = runAvailabilityCheck,
): Promise<NavigationOutcome> {
    const session = await sessionManager.acquire();

    try {
        return await runCheck(session.page, request);
    } finally {
        await sessionManager.release(session);
    }
}
