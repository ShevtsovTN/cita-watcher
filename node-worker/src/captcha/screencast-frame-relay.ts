/**
 * Пайпит кадры CDP-скринкаста (`Page.startScreencast`) одной привязанной `CDPSession` в один WS-
 * сокет (см. ../../docs/NODE_WORKER_ROADMAP.md Phase 2, третий пункт чек-листа). Место в конвейере:
 * `relay-server.ts` валидирует форму токена → `session-binder.ts` резолвит его в `AutomationSession`
 * → отсюда вызывающая сторона (ещё не существующего Phase 4 wiring) берёт
 * `session.newCdpSession()` и передаёт сюда вместе с уже принятым сокетом.
 *
 * Исходящее сообщение клиенту — только `{type, data}` (base64, как есть у CDP, без
 * перекодирования); `sessionId`/`metadata` кадра остаются внутренним делом акка CDP и наружу не
 * идут. Нести ли клиенту `metadata` (нужна для маппинга координат обратного ввода, Phase 2, item
 * 4) — решение того пункта, не этого: гадать про ещё не спроектированный wire-контракт
 * несуществующего UI здесь не будем (тот же принцип, что `PostSubmitUnconfirmed` в
 * `../automation/site-navigator.ts`).
 */

import type { CDPSession } from "playwright";
import type { WebSocket } from "ws";

export interface ScreencastFrameMessage {
    readonly type: "screencast_frame";
    readonly data: string;
}

/** Минимальная форма `Page.screencastFrame`, которая нам реально нужна — не весь CDP-payload. */
interface CdpScreencastFramePayload {
    readonly data: string;
    readonly sessionId: number;
}

const START_SCREENCAST_OPTIONS = { format: "jpeg", quality: 80, everyNthFrame: 1 } as const;

export interface ScreencastFrameRelay {
    start(): Promise<void>;
    stop(): Promise<void>;
}

export class CdpScreencastFrameRelay implements ScreencastFrameRelay {
    private frameListener: ((payload: CdpScreencastFramePayload) => void) | undefined;

    public constructor(
        private readonly cdpSession: CDPSession,
        private readonly socket: WebSocket,
    ) {}

    public async start(): Promise<void> {
        if (this.frameListener !== undefined) {
            return;
        }

        const listener = (payload: CdpScreencastFramePayload): void => {
            this.handleFrame(payload);
        };

        this.frameListener = listener;
        this.cdpSession.on("Page.screencastFrame", listener);

        await this.cdpSession.send("Page.startScreencast", START_SCREENCAST_OPTIONS);
    }

    public async stop(): Promise<void> {
        const listener = this.frameListener;
        this.frameListener = undefined;

        if (listener === undefined) {
            return;
        }

        this.cdpSession.off("Page.screencastFrame", listener);
        await this.cdpSession.send("Page.stopScreencast");
    }

    private handleFrame(payload: CdpScreencastFramePayload): void {
        const message: ScreencastFrameMessage = { type: "screencast_frame", data: payload.data };

        this.socket.send(JSON.stringify(message));

        /**
         * Ack не ждём и не даём его провалу утопить relay: CDP должен получить его независимо от
         * состояния WS-сокета, иначе скринкаст встанет намертво после первого же обрыва
         * соединения — а восстановить его тут всё равно нечем (сокет уже мёртв).
         */
        void this.cdpSession.send("Page.screencastFrameAck", { sessionId: payload.sessionId }).catch(() => undefined);
    }
}
