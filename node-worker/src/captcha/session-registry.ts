/**
 * Связывает `SessionToken` (тот, что встраивается в `/captcha-ws/<token>`) с конкретной
 * `AutomationSession`, чтобы входящее WS-соединение (`relay-server.ts`) знало, к какой
 * браузерной сессии его привязывать (см. ../../docs/NODE_WORKER_ROADMAP.md Phase 2, второй пункт
 * чек-листа). Phase 7: теперь также единственный мост между WS-стороной (`index.ts`'s
 * `relayCaptchaSession`, получает сигнал `"resolved"` от `CdpInputRelay`) и стороной, реально
 * ждущей человека (`../messaging/command-handler.ts`, держит сессию через
 * `AvailabilityCheckResult.pendingCaptchaSession`) — `register()` теперь принимает колбэк
 * `onResolved`, вызываемый через `notifyResolved()`, а не только сам факт привязки токена к
 * сессии.
 */

import type { AutomationSession } from "../automation";
import type { SessionToken } from "../session-token";

export interface CaptchaSessionRegistry {
    register(token: SessionToken, session: AutomationSession, onResolved: () => void): void;
    resolve(token: SessionToken): AutomationSession | undefined;
    /** No-op if `token` isn't (or is no longer) registered — matches `unregister()`'s existing quiet-no-op style. */
    notifyResolved(token: SessionToken): void;
    unregister(token: SessionToken): void;
}

interface RegisteredCaptchaSession {
    readonly session: AutomationSession;
    readonly onResolved: () => void;
}

export class InMemoryCaptchaSessionRegistry implements CaptchaSessionRegistry {
    private readonly sessions = new Map<SessionToken, RegisteredCaptchaSession>();

    public register(token: SessionToken, session: AutomationSession, onResolved: () => void): void {
        this.sessions.set(token, { session, onResolved });
    }

    public resolve(token: SessionToken): AutomationSession | undefined {
        return this.sessions.get(token)?.session;
    }

    public notifyResolved(token: SessionToken): void {
        this.sessions.get(token)?.onResolved();
    }

    public unregister(token: SessionToken): void {
        this.sessions.delete(token);
    }
}
