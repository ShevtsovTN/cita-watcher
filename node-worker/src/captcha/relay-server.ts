/**
 * WS-сервер для `/captcha-ws/<token>` (см. ../../docs/NODE_WORKER_ROADMAP.md Phase 2, первый
 * пункт чек-листа). nginx проксирует этот путь на `config.cdpRelay.port` без какой-либо
 * аутентификации (см. корневой ../../../CLAUDE.md, "Cross-service architecture") — единственная
 * проверка входящего соединения здесь. На этом шаге проверяется только форма токена
 * (`isSessionToken`, ../session-token.ts); соединения с некорректным/отсутствующим токеном
 * закрываются немедленно. Привязка валидного соединения к конкретной
 * `AutomationSession`/CDP-таргету, а также сам relay кадров скринкаста и обратный relay ввода —
 * следующие пункты Phase 2, сюда намеренно не входят: до них не существует ни реестра токен →
 * сессия, ни source of truth о том, какая сессия вообще ждёт капчу.
 */

import type { IncomingMessage } from "node:http";
import { WebSocketServer, type ServerOptions, type WebSocket } from "ws";

import { isSessionToken, type SessionToken } from "../session-token";

const RELAY_PATH_PREFIX = "/captcha-ws/";

/** Приватный диапазон WS close-кодов (4000-4999, RFC 6455) — не наш случай не пытаться decode протокол дальше. */
export const INVALID_SESSION_TOKEN_CLOSE_CODE = 4400;
export const INVALID_SESSION_TOKEN_CLOSE_REASON = "invalid or missing session token";

/**
 * Достаёт и валидирует токен из пути запроса (`req.url` у `ws`/`http` — это path[+query], без
 * host). Чистая функция — тестируется без реального WS-соединения.
 */
export function extractSessionToken(requestUrl: string | undefined): SessionToken | undefined {
    if (requestUrl === undefined || !requestUrl.startsWith(RELAY_PATH_PREFIX)) {
        return undefined;
    }

    const afterPrefix = requestUrl.slice(RELAY_PATH_PREFIX.length);
    const token = afterPrefix.split(/[?#]/)[0] ?? "";

    return isSessionToken(token) ? token : undefined;
}

export interface ScreencastRelay {
    start(): void;
    stop(): Promise<void>;
}

type WebSocketServerFactory = (options: ServerOptions) => WebSocketServer;

const defaultServerFactory: WebSocketServerFactory = (options) => new WebSocketServer(options);

export class WsScreencastRelay implements ScreencastRelay {
    private server: WebSocketServer | undefined;

    public constructor(
        private readonly port: number,
        /** Вызывается только для соединений с валидной по форме токена — см. докблок модуля. */
        private readonly onValidConnection: (token: SessionToken, socket: WebSocket) => void,
        private readonly createServer: WebSocketServerFactory = defaultServerFactory,
    ) {}

    public start(): void {
        if (this.server !== undefined) {
            return;
        }

        const server = this.createServer({ port: this.port });

        server.on("connection", (socket, request) => {
            this.handleConnection(socket, request);
        });

        this.server = server;
    }

    public async stop(): Promise<void> {
        const server = this.server;
        this.server = undefined;

        if (server === undefined) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error !== undefined) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    private handleConnection(socket: WebSocket, request: IncomingMessage): void {
        const token = extractSessionToken(request.url);

        if (token === undefined) {
            socket.close(INVALID_SESSION_TOKEN_CLOSE_CODE, INVALID_SESSION_TOKEN_CLOSE_REASON);
            return;
        }

        this.onValidConnection(token, socket);
    }
}
