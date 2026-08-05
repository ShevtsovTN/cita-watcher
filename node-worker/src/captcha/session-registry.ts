/**
 * Связывает `SessionToken` (тот, что встраивается в `/captcha-ws/<token>`) с конкретной
 * `AutomationSession`, чтобы входящее WS-соединение (`relay-server.ts`) знало, к какой
 * браузерной сессии его привязывать (см. ../../docs/NODE_WORKER_ROADMAP.md Phase 2, второй пункт
 * чек-листа). Кто и когда вызывает `register()` — открытый вопрос ещё с Phase 0 (см.
 * ../session-token.ts докблок): пока ни `automation/` не умеет реально детектировать капчу
 * (Phase 1's `PostSubmitUnconfirmed`), ни `messaging/` не существует (Phase 3), вызывающего
 * кода нет — этот модуль описывает только сам механизм привязки, не то, что её запускает.
 */

import type { AutomationSession } from "../automation";
import type { SessionToken } from "../session-token";

export interface CaptchaSessionRegistry {
    register(token: SessionToken, session: AutomationSession): void;
    resolve(token: SessionToken): AutomationSession | undefined;
    unregister(token: SessionToken): void;
}

export class InMemoryCaptchaSessionRegistry implements CaptchaSessionRegistry {
    private readonly sessions = new Map<SessionToken, AutomationSession>();

    public register(token: SessionToken, session: AutomationSession): void {
        this.sessions.set(token, session);
    }

    public resolve(token: SessionToken): AutomationSession | undefined {
        return this.sessions.get(token);
    }

    public unregister(token: SessionToken): void {
        this.sessions.delete(token);
    }
}
