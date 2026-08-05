/**
 * Привязывает соединение, уже прошедшее проверку формы токена в `relay-server.ts`, к реальной
 * `AutomationSession` через `CaptchaSessionRegistry` (см. ../../docs/NODE_WORKER_ROADMAP.md
 * Phase 2, второй пункт чек-листа). Токен корректной формы, но не зарегистрированный ни за одной
 * сессией (уже решён/протух/никогда не выдавался), закрывается отдельным close-кодом — сама форма
 * была валидна, значит это не тот случай, что `INVALID_SESSION_TOKEN_CLOSE_CODE` в
 * `relay-server.ts`. Сам relay кадров скринкаста и ввода (Phase 2, пункты 3-4) сюда не входит —
 * `onBound` получает тройку `(token, session, socket)`, что с ними делать дальше — забота
 * вызывающей стороны (`index.ts`'s `relayCaptchaSession`, Phase 4 wiring / Phase 7 resolution).
 */

import type { WebSocket } from "ws";

import type { AutomationSession } from "../automation";
import type { SessionToken } from "../session-token";
import type { CaptchaSessionRegistry } from "./session-registry";

export const UNKNOWN_SESSION_TOKEN_CLOSE_CODE = 4404;
export const UNKNOWN_SESSION_TOKEN_CLOSE_REASON = "unknown or expired session token";

/**
 * Возвращает обработчик в форме, ожидаемой `WsScreencastRelay`'s `onValidConnection`
 * (`relay-server.ts`) — тот же DI-шов, что `BrowserLauncher`/`WebSocketServerFactory` в других
 * модулях: реестр и колбэк захватываются один раз при постройке. `onBound` получает и сам токен
 * (Phase 7) — `index.ts`'s `relayCaptchaSession` теперь нуждается в нём, чтобы вызвать
 * `registry.notifyResolved(token)`, когда `CdpInputRelay` увидит `"resolved"`.
 */
export function bindConnectionToRegisteredSession(
    registry: CaptchaSessionRegistry,
    onBound: (token: SessionToken, session: AutomationSession, socket: WebSocket) => void,
): (token: SessionToken, socket: WebSocket) => void {
    return (token, socket) => {
        const session = registry.resolve(token);

        if (session === undefined) {
            socket.close(UNKNOWN_SESSION_TOKEN_CLOSE_CODE, UNKNOWN_SESSION_TOKEN_CLOSE_REASON);
            return;
        }

        onBound(token, session, socket);
    };
}
