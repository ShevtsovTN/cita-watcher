/**
 * Обратный relay: WS-сообщения от человека (клики/клавиши) → CDP `Input.dispatchMouseEvent`/
 * `Input.dispatchKeyEvent` на привязанной `CDPSession`, плюс сигнал "капча решена, можно
 * продолжать" (см. ../../docs/NODE_WORKER_ROADMAP.md Phase 2, четвёртый/последний пункт
 * чек-листа). Место в конвейере то же, что у `screencast-frame-relay.ts`: вызывающая сторона
 * (Phase 4 wiring, ещё не существует) берёт `session.newCdpSession()` и уже принятый сокет.
 *
 * Wire-контракт сообщений клиент → воркер — как и исходящий формат кадра в
 * `screencast-frame-relay.ts`, это решение для несуществующего пока UI: минимальный набор полей,
 * которого достаточно, чтобы реально подвинуть мышь/нажать клавишу в Chromium, а не гадание про
 * то, чего клиент, быть может, когда-нибудь захочет. Входящее сообщение — untrusted (from a
 * human's browser, no schema enforced by anything upstream), поэтому парсинг никогда не бросает:
 * что угодно нераспознанное просто отбрасывается.
 */

import type { CDPSession } from "playwright";
import type { RawData, WebSocket } from "ws";

const MOUSE_EVENT_KINDS = ["mousePressed", "mouseReleased", "mouseMoved"] as const;
type MouseEventKind = (typeof MOUSE_EVENT_KINDS)[number];

const MOUSE_BUTTONS = ["left", "right", "middle"] as const;
type MouseButton = (typeof MOUSE_BUTTONS)[number];

const KEY_EVENT_KINDS = ["keyDown", "keyUp", "char"] as const;
type KeyEventKind = (typeof KEY_EVENT_KINDS)[number];

export interface RemoteMouseInput {
    readonly type: "mouse";
    readonly kind: MouseEventKind;
    readonly x: number;
    readonly y: number;
    readonly button?: MouseButton;
    readonly clickCount?: number;
}

export interface RemoteKeyInput {
    readonly type: "key";
    readonly kind: KeyEventKind;
    readonly key: string;
    readonly code?: string;
    readonly text?: string;
}

export interface RemoteResolvedSignal {
    readonly type: "resolved";
}

export type RemoteInputMessage = RemoteMouseInput | RemoteKeyInput | RemoteResolvedSignal;

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function parseMouseInput(candidate: Readonly<Record<string, unknown>>): RemoteMouseInput | undefined {
    const kind = candidate["kind"];
    const x = candidate["x"];
    const y = candidate["y"];

    if (!isOneOf(kind, MOUSE_EVENT_KINDS) || typeof x !== "number" || typeof y !== "number") {
        return undefined;
    }

    const button = candidate["button"];
    if (button !== undefined && !isOneOf(button, MOUSE_BUTTONS)) {
        return undefined;
    }

    const clickCount = candidate["clickCount"];
    if (clickCount !== undefined && typeof clickCount !== "number") {
        return undefined;
    }

    return {
        type: "mouse",
        kind,
        x,
        y,
        ...(button !== undefined ? { button } : {}),
        ...(clickCount !== undefined ? { clickCount } : {}),
    };
}

function parseKeyInput(candidate: Readonly<Record<string, unknown>>): RemoteKeyInput | undefined {
    const kind = candidate["kind"];
    const key = candidate["key"];

    if (!isOneOf(kind, KEY_EVENT_KINDS) || typeof key !== "string") {
        return undefined;
    }

    const code = candidate["code"];
    if (code !== undefined && typeof code !== "string") {
        return undefined;
    }

    const text = candidate["text"];
    if (text !== undefined && typeof text !== "string") {
        return undefined;
    }

    return {
        type: "key",
        kind,
        key,
        ...(code !== undefined ? { code } : {}),
        ...(text !== undefined ? { text } : {}),
    };
}

/** `RawData` = `Buffer | ArrayBuffer | Buffer[]` — голый `.toString()` даёт `[object ArrayBuffer]` для двух из трёх вариантов. */
function rawDataToString(data: RawData): string {
    if (Buffer.isBuffer(data)) {
        return data.toString("utf8");
    }

    if (Array.isArray(data)) {
        return Buffer.concat(data).toString("utf8");
    }

    return Buffer.from(data).toString("utf8");
}

/** Никогда не бросает — некорректный JSON/неизвестная форма молча становится `undefined`. */
export function parseRemoteInputMessage(raw: string): RemoteInputMessage | undefined {
    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }

    if (typeof parsed !== "object" || parsed === null) {
        return undefined;
    }

    const candidate = parsed as Readonly<Record<string, unknown>>;

    switch (candidate["type"]) {
        case "mouse":
            return parseMouseInput(candidate);
        case "key":
            return parseKeyInput(candidate);
        case "resolved":
            return { type: "resolved" };
        default:
            return undefined;
    }
}

export interface InputRelay {
    start(): void;
    stop(): void;
}

export class CdpInputRelay implements InputRelay {
    private messageListener: ((data: RawData) => void) | undefined;

    public constructor(
        private readonly cdpSession: CDPSession,
        private readonly socket: WebSocket,
        /** "Сигнал автоматизации продолжать" из докблока модуля — вызывается на `resolved`. */
        private readonly onResolved: () => void,
    ) {}

    public start(): void {
        if (this.messageListener !== undefined) {
            return;
        }

        const listener = (data: RawData): void => {
            void this.handleMessage(data);
        };

        this.messageListener = listener;
        this.socket.on("message", listener);
    }

    public stop(): void {
        const listener = this.messageListener;
        this.messageListener = undefined;

        if (listener === undefined) {
            return;
        }

        this.socket.off("message", listener);
    }

    private async handleMessage(data: RawData): Promise<void> {
        const message = parseRemoteInputMessage(rawDataToString(data));

        if (message === undefined) {
            return;
        }

        switch (message.type) {
            case "mouse":
                await this.dispatchMouseInput(message);
                return;
            case "key":
                await this.dispatchKeyInput(message);
                return;
            case "resolved":
                this.onResolved();
                return;
        }
    }

    private async dispatchMouseInput(message: RemoteMouseInput): Promise<void> {
        await this.cdpSession.send("Input.dispatchMouseEvent", {
            type: message.kind,
            x: message.x,
            y: message.y,
            ...(message.button !== undefined ? { button: message.button } : {}),
            ...(message.clickCount !== undefined ? { clickCount: message.clickCount } : {}),
        });
    }

    private async dispatchKeyInput(message: RemoteKeyInput): Promise<void> {
        await this.cdpSession.send("Input.dispatchKeyEvent", {
            type: message.kind,
            key: message.key,
            ...(message.code !== undefined ? { code: message.code } : {}),
            ...(message.text !== undefined ? { text: message.text } : {}),
        });
    }
}
